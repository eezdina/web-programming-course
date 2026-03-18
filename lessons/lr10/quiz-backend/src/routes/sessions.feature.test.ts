import { describe, it, expect, beforeEach } from "vitest"
import { app } from "../../tests/setup/test-app.js"
import { resetTestDb } from "../../tests/setup/test-db.js"
import { prisma } from "../db/prisma.js"

describe("Sessions feature", () => {
  let authToken: string
  let categoryId: string
  let questionId: string

  beforeEach(async () => {
    await resetTestDb()

    // Получаем токен через GitHub callback
    const authRes = await app.request("/api/auth/github/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test_ok" })
    })
    const authData = await authRes.json()
    authToken = authData.token

    // Создаем категорию с уникальным slug
    const timestamp = Date.now()
    const category = await prisma.category.create({
      data: {
        name: `Test Category ${timestamp}`,
        slug: `test-category-${timestamp}`
      }
    })
    categoryId = category.id

    // Создаем вопрос
    const question = await prisma.question.create({
      data: {
        text: "What is 2+2?",
        type: "single-select",
        categoryId: categoryId,
        correctAnswer: "4",
        points: 5
      }
    })
    questionId = question.id
  })

  it("create session without token returns 401", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST"
    })

    expect(res.status).toBe(401)
  })

  it("get session without token returns 401", async () => {
    const res = await app.request("/api/sessions/test", {
      method: "GET"
    })

    expect(res.status).toBe(401)
  })

  it("submit answer without token returns 401", async () => {
    const res = await app.request("/api/sessions/test/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: "q1",
        answer: "4"
      })
    })

    expect(res.status).toBe(401)
  })

  it("should create a new session", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${authToken}`
      }
    })

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.session).toBeDefined()
    expect(data.session.id).toBeDefined()
    expect(data.session.status).toBe("in_progress")
    expect(data.totalQuestions).toBe(1)
  })

  it("should not allow user to answer in someone else's session", async () => {
    // Создаем первого пользователя (владелец сессии)
    const authRes1 = await app.request("/api/auth/github/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test_owner" })
    })
    const authData1 = await authRes1.json()
    const ownerToken = authData1.token

    // Создаем второго пользователя (злоумышленник)
    const authRes2 = await app.request("/api/auth/github/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test_intruder" })
    })
    const authData2 = await authRes2.json()
    const intruderToken = authData2.token

    // Создаем категорию с уникальным slug для этого теста
    const timestamp = Date.now()
    const category = await prisma.category.create({
      data: {
        name: `Security Test Category ${timestamp}`,
        slug: `security-test-category-${timestamp}`
      }
    })

    // Создаем вопрос
    const question = await prisma.question.create({
      data: {
        text: "Security test question",
        type: "single-select",
        categoryId: category.id,
        correctAnswer: "42",
        points: 5
      }
    })

    // Создаем сессию для первого пользователя (владельца)
    const sessionRes = await app.request("/api/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ownerToken}`
      }
    })
    
    expect(sessionRes.status).toBe(201)
    const sessionData = await sessionRes.json()
    const newSessionId = sessionData.session.id

    // Проверка 1: Владелец может отвечать в свою сессию (должно работать)
    const ownerAnswerRes = await app.request(`/api/sessions/${newSessionId}/answers`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        questionId: question.id,
        answer: "42"
      })
    })
    
    expect(ownerAnswerRes.status).toBe(200)

    // Проверка 2: Злоумышленник НЕ может отвечать в чужую сессию (должно падать с 403)
    const intruderAnswerRes = await app.request(`/api/sessions/${newSessionId}/answers`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${intruderToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        questionId: question.id,
        answer: "42"
      })
    })

    // Ожидаем ошибку доступа
    expect(intruderAnswerRes.status).toBe(403)
    const errorData = await intruderAnswerRes.json()
    expect(errorData.error).toContain('permission')
  })
})