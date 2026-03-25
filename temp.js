import crypto from "crypto";
import express from "express";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET;
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const OWNER = "sf-zd-sbx";
const REPO = "shiny-dollop";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GITHUB_APP_CLIENT_ID or GITHUB_APP_CLIENT_SECRET.");
  process.exit(1);
}

const app = express();
const stateStore = new Map();

function buildAuthorizeUrl(state) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${BASE_URL}/callback`);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: `${BASE_URL}/callback`
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json"
    },
    body
  });

  if (!res.ok) {
    const fullResponse = await res.json();
    throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(fullResponse)}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Missing access token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function fetchIssues(token) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues?state=open&per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );

  if (!res.ok) {
    const fullResponse = await res.json();
    throw new Error(`Issue request failed: ${res.status} ${JSON.stringify(fullResponse)}`);
  }

  const issues = await res.json();
  return issues.filter((issue) => !issue.pull_request);
}

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub App OAuth</title>
    <style>
      body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 48px; }
      .card { max-width: 520px; padding: 24px; border: 1px solid #ddd; border-radius: 12px; }
      a.button { display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>GitHub App OAuth</h1>
      <p>Authorize to list open issues from ${OWNER}/${REPO}.</p>
      <a class="button" href="/login">Authorize with GitHub</a>
    </div>
  </body>
</html>`);
});

app.get("/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, Date.now());
  res.redirect(buildAuthorizeUrl(state));
});

app.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).send("Missing code or state.");
      return;
    }

    if (!stateStore.has(state)) {
      res.status(400).send("Invalid state.");
      return;
    }

    stateStore.delete(state);

    const token = await exchangeCodeForToken(code);
    const issues = await fetchIssues(token);

    const items = issues
      .map(
        (issue) =>
          `<li><a href="${issue.html_url}" target="_blank" rel="noreferrer">#${issue.number} ${issue.title}</a></li>`
      )
      .join("");

    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issues</title>
    <style>
      body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 48px; }
      ul { padding-left: 20px; }
    </style>
  </head>
  <body>
    <h1>Open issues for ${OWNER}/${REPO}</h1>
    ${issues.length ? `<ul>${items}</ul>` : "<p>No issues found.</p>"}
    <p><a href="/">Back</a></p>
  </body>
</html>`);
  } catch (error) {
    res.status(500).send(`Auth failed: ${error.message}`);
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server running at ${BASE_URL}`);
});
