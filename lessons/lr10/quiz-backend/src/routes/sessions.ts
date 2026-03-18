import { Hono } from 'hono'
import { prisma } from '../db/prisma.js'
import { authMiddleware } from '../middleware/authMiddleware.js'
import { sessionService } from '../services/sessionService.js'
import { AnswerSchema } from '../utils/validation.js'

const sessionsRoute = new Hono()

// Create session
sessionsRoute.post('/', authMiddleware, async (c) => {
  const user = c.get('user')

  // Проверяем, есть ли вопросы
  const totalQuestions = await prisma.question.count()
  if (totalQuestions === 0) {
    return c.json({ error: 'No questions available. Please contact administrator.' }, 400)
  }

  // Проверяем, нет ли уже активной сессии
  const activeSession = await prisma.session.findFirst({
    where: {
      userId: user.id,
      status: 'in_progress',
      expiresAt: { gt: new Date() }
    }
  })

  if (activeSession) {
    return c.json({ 
      error: 'You already have an active session',
      session: activeSession 
    }, 400)
  }

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 час
    },
  })

  return c.json(
    {
      session,
      totalQuestions
    },
    201
  )
})

// Submit answer (with validation) - ИСПРАВЛЕНО
sessionsRoute.post('/:id/answers', authMiddleware, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')  // Получаем пользователя из middleware
  const body = await c.req.json()

  const parsed = AnswerSchema.safeParse({
    ...body,
    sessionId: id,
  })

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400)
  }

  try {
    const answer = await sessionService.submitAnswer(
      id,
      parsed.data.questionId,
      parsed.data.answer,  // В схеме поле answer, не userAnswer
      user.id  // Передаем userId для проверки
    )

    return c.json({ answer })
  } catch (e: any) {
    // Если ошибка связана с правами доступа - возвращаем 403
    if (e.message.includes('permission')) {
      return c.json({ error: e.message }, 403)
    }
    return c.json({ error: e.message }, 400)
  }
})

// Get session
sessionsRoute.get('/:id', authMiddleware, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      answers: {
        include: { 
          question: {
            select: {
              id: true,
              text: true,
              type: true,
              points: true
            }
          }
        },
      },
    },
  })

  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.userId !== user.id) return c.json({ error: 'Forbidden' }, 403)

  return c.json({ session })
})

// Submit session - ИСПРАВЛЕНО
sessionsRoute.post('/:id/submit', authMiddleware, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  if (!id) {
    return c.json({ error: 'Invalid id' }, 400)
  }

  try {
    const session = await sessionService.submitSession(id, user.id)  // Передаем userId
    return c.json({ session })
  } catch (e: any) {
    if (e.message.includes('permission')) {
      return c.json({ error: e.message }, 403)
    }
    return c.json({ error: e.message }, 400)
  }
})

export default sessionsRoute