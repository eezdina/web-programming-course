export type GitHubUser = {
  id: number;
  email?: string;
  name?: string;
};

/*
 * Инструкция по использованию GitHub-сервиса:
 * 1) Для реального OAuth задайте переменные окружения:
 *    - GITHUB_CLIENT_ID
 *    - GITHUB_CLIENT_SECRET
 * 2) Из роута вызовите:
 *    const githubUser = await getGitHubUserByCode(code)
 * 3) Для локального тестирования без GitHub используйте code с префиксом "test_".
 */

type GitHubTokenResponse = {
  access_token?: string;
  error?: string;
};

type GitHubUserResponse = {
  id?: number;
  email?: string;
  name?: string;
};

export class GitHubServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 500,
  ) {
    super(message);
    this.name = "GitHubServiceError";
  }
}

async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new GitHubServiceError("GitHub credentials not configured", 500);
  }

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );

  const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;

  if (!tokenData.access_token) {
    throw new GitHubServiceError("Failed to get access token from GitHub", 400);
  }

  return tokenData.access_token;
}

async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const githubUser = (await userResponse.json()) as GitHubUserResponse;

  if (!githubUser.id) {
    throw new GitHubServiceError("Failed to get user data from GitHub", 400);
  }

  return {
    id: githubUser.id,
    email: githubUser.email,
    name: githubUser.name,
  };
}

export async function getGitHubUserByCode(code: string): Promise<GitHubUser> {
  if (code.startsWith("test_")) {
    const suffix = code.replace('test_', '') || 'default'
    let hash = 0;
    for (let i = 0; i < suffix.length; i++) {
      hash = ((hash << 5) - hash) + suffix.charCodeAt(i);
      hash |= 0;
    }
    const uniqueId = Math.abs(hash);
    
    return {
      id: uniqueId,
      email: `user_${suffix}@example.com`,
      name: `User ${suffix}`,
    };
  }

  const accessToken = await exchangeCodeForAccessToken(code);
  return getGitHubUser(accessToken);
}