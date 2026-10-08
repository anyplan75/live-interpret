const { firebase, redactSecrets, authErrorMessage } = require("./catalog");
const { netFetch } = require("./net-fetch");

async function postJson(url, body) {
  const res = await netFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readAuthResponse(res);
}

async function postForm(url, params) {
  const res = await netFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return readAuthResponse(res);
}

async function readAuthResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const message = data && data.error && (data.error.message || data.error) ? (data.error.message || data.error) : text;
    throw new Error(authErrorMessage({ message: redactSecrets(message) }));
  }
  return data || {};
}

async function signIn(email, password) {
  const data = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebase.apiKey)}`,
    { email, password, returnSecureToken: true }
  );
  if (!data.idToken || !data.refreshToken) throw new Error("로그인 응답이 올바르지 않습니다.");
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    localId: data.localId || "",
    email: data.email || email,
    expiresIn: Number(data.expiresIn) || 3600,
  };
}

async function refresh(refreshToken) {
  const data = await postForm(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebase.apiKey)}`,
    { grant_type: "refresh_token", refresh_token: refreshToken }
  );
  if (!data.id_token) throw new Error("로그인 세션을 갱신하지 못했습니다.");
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token || refreshToken,
    localId: data.user_id || "",
    expiresIn: Number(data.expires_in) || 3600,
  };
}

module.exports = { signIn, refresh };
