import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockDeep, mockReset } from "vitest-mock-extended"
import type { PrismaClient } from "@prisma/client"
import { sessionService } from "./sessionService.js"
import { scoringService } from "./scoringService.js"

vi.mock("../db/prisma.js", () => ({
  prisma: mockDeep<PrismaClient>()
}))

import { prisma } from "../db/prisma.js"
const prismaMock = prisma as unknown as ReturnType<typeof mockDeep<PrismaClient>>

describe("SessionService Unit Tests", () => {
  const mockUserId = "user123"
  
  beforeEach(() => {
    mockReset(prismaMock)
  })

  describe("submitAnswer", () => {
    it("should throw error if question not found", async () => {
      // Мокаем поиск сессии (возвращаем сессию пользователя)
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: mockUserId,
        status: "in_progress",
        expiresAt: new Date(Date.now() + 3600000)
      } as any)
      
      // Мокаем поиск вопроса (не найден)
      prismaMock.question.findUnique.mockResolvedValue(null)
      
      // Мокаем транзакцию
      prismaMock.$transaction.mockImplementation(async (callback) => {
        return callback(prismaMock)
      })

      await expect(sessionService.submitAnswer(
        "session123",
        "question123",
        "4",
        mockUserId  // Добавляем userId
      )).rejects.toThrow("Question not found")
    })

    it("should throw error if session belongs to another user", async () => {
      // Сессия принадлежит другому пользователю
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: "another-user",  // Чужой userId
        status: "in_progress",
        expiresAt: new Date(Date.now() + 3600000)
      } as any)

      await expect(sessionService.submitAnswer(
        "session123",
        "question123",
        "4",
        mockUserId  // Текущий пользователь
      )).rejects.toThrow("permission")
    })

    it("should calculate score for single-select", async () => {
      // Мокаем сессию
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: mockUserId,
        status: "in_progress",
        expiresAt: new Date(Date.now() + 3600000)
      } as any)
      
      // Мокаем вопрос
      const mockQuestion = {
        id: "question123",
        type: "single-select",
        correctAnswer: "4"
      } as any

      prismaMock.question.findUnique.mockResolvedValue(mockQuestion)
      prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock))
      
      // Мокаем, что ответа еще нет
      prismaMock.answer.findUnique.mockResolvedValue(null)
      
      prismaMock.answer.upsert.mockResolvedValue({} as any)

      await sessionService.submitAnswer(
        "session123", 
        "question123", 
        "4",
        mockUserId
      )
      expect(prismaMock.answer.upsert).toHaveBeenCalled()
    })

    it("should calculate score for multiple-select", async () => {
      // Мокаем сессию
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: mockUserId,
        status: "in_progress",
        expiresAt: new Date(Date.now() + 3600000)
      } as any)
      
      const mockQuestion = {
        id: "question123",
        type: "multiple-select",
        correctAnswer: ["A", "C"]
      } as any

      prismaMock.question.findUnique.mockResolvedValue(mockQuestion)
      prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock))
      
      // Мокаем, что ответа еще нет
      prismaMock.answer.findUnique.mockResolvedValue(null)
      
      const spy = vi.spyOn(scoringService, "scoreMultipleSelect")
      prismaMock.answer.upsert.mockResolvedValue({} as any)
      
      await sessionService.submitAnswer(
        "session123", 
        "question123", 
        ["A", "B"],
        mockUserId
      )
      expect(spy).toHaveBeenCalled()
    })

    it("should throw error if answering same question twice", async () => {
      // Мокаем сессию
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: mockUserId,
        status: "in_progress",
        expiresAt: new Date(Date.now() + 3600000)
      } as any)
      
      // Мокаем вопрос
      const mockQuestion = {
        id: "question123",
        type: "single-select",
        correctAnswer: "4"
      } as any

      prismaMock.question.findUnique.mockResolvedValue(mockQuestion)
      
      // Мокаем транзакцию с проверкой существующего ответа
      prismaMock.$transaction.mockImplementation(async (callback) => {
        // Симулируем, что ответ уже существует
        const error = new Error("You have already answered this question")
        throw error
      })

      await expect(sessionService.submitAnswer(
        "session123",
        "question123",
        "4",
        mockUserId
      )).rejects.toThrow("already answered")
    })
  })

  describe("submitSession", () => {
    it("should throw error if session belongs to another user", async () => {
      // Сессия принадлежит другому пользователю
      prismaMock.session.findUnique.mockResolvedValue({
        id: "session123",
        userId: "another-user",  // Чужой userId
        expiresAt: new Date(Date.now() + 3600000),
        answers: []
      } as any)

      await expect(sessionService.submitSession(
        "session123",
        mockUserId  // Текущий пользователь
      )).rejects.toThrow("permission")
    })

    it("should throw error if session expired", async () => {
      // Сессия принадлежит текущему пользователю, но истекла
      const mockSession = {
        id: "session123",
        userId: mockUserId,
        expiresAt: new Date(Date.now() - 1000), // просрочена
        answers: []
      } as any

      prismaMock.session.findUnique.mockResolvedValue(mockSession)

      await expect(sessionService.submitSession(
        "session123",
        mockUserId
      )).rejects.toThrow("expired")
    })

    it("should calculate total score on submit", async () => {
      // Сессия принадлежит текущему пользователю
      const mockSession = {
        id: "session123",
        userId: mockUserId,
        expiresAt: new Date(Date.now() + 10000),
        answers: [
          { score: 1 },
          { score: 0.5 }
        ]
      } as any

      prismaMock.session.findUnique.mockResolvedValue(mockSession)
      prismaMock.session.update.mockResolvedValue({} as any)

      await sessionService.submitSession("session123", mockUserId)
      
      expect(prismaMock.session.update).toHaveBeenCalledWith({
        where: { id: "session123" },
        data: {
          status: "completed",
          score: 1.5,
          completedAt: expect.any(Date)
        }
      })
    })
  })
})