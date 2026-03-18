import { prisma } from '../db/prisma.js'
import { scoringService } from './scoringService.js'

class SessionService {
  async submitAnswer(
    sessionId: string,
    questionId: string,
    userAnswer: any,
    userId: string  // Добавлен параметр userId
  ) {
    // Проверяем, что сессия принадлежит пользователю
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, status: true, expiresAt: true }
    })

    if (!session) {
      throw new Error('Session not found')
    }

    if (session.userId !== userId) {
      throw new Error('You do not have permission to answer in this session')
    }

    if (session.status !== 'in_progress') {
      throw new Error('Session is not active')
    }

    if (session.expiresAt < new Date()) {
      throw new Error('Session has expired')
    }

    return prisma.$transaction(async (tx) => {
      // Проверяем, не отвечали ли уже на этот вопрос
      const existingAnswer = await tx.answer.findUnique({
        where: {
          sessionId_questionId: {
            sessionId,
            questionId,
          },
        },
      })

      if (existingAnswer) {
        throw new Error('You have already answered this question')
      }

      const question = await tx.question.findUnique({
        where: { id: questionId },
      })

      if (!question) throw new Error('Question not found')

      let score: number | null = null
      let isCorrect: boolean | null = null

      if (question.type === 'multiple-select') {
        score = scoringService.scoreMultipleSelect(
          question.correctAnswer as string[],
          userAnswer as string[]
        )
        isCorrect = score > 0
      }

      if (question.type === 'single-select') {
        score = userAnswer === question.correctAnswer ? 1 : 0
        isCorrect = score > 0
      }

      // Для essay score остается null до проверки админом

      const answer = await tx.answer.upsert({
        where: {
          sessionId_questionId: {
            sessionId,
            questionId,
          },
        },
        update: {
          userAnswer,
          score,
          isCorrect,
        },
        create: {
          sessionId,
          questionId,
          userAnswer,
          score,
          isCorrect,
        },
      })

      return answer
    })
  }

  async submitSession(sessionId: string, userId: string) {  // Добавлен userId
    // Проверяем, что сессия принадлежит пользователю
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { answers: true }
    })

    if (!session) throw new Error('Session not found')
    
    if (session.userId !== userId) {
      throw new Error('You do not have permission to submit this session')
    }

    if (session.status === 'completed') {
      throw new Error('Session already completed')
    }

    if (session.expiresAt < new Date()) {
      // Автоматически помечаем как expired
      return prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'expired',
        },
      })
    }

    const totalScore = session.answers.reduce(
      (sum, a) => sum + (a.score ?? 0),
      0
    )

    return prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        score: totalScore,
        completedAt: new Date(),
      },
    })
  }
}

export const sessionService = new SessionService()