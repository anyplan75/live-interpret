/**
 * Identity Toolkit REST. 브라우저의 Firebase Auth 세션을 바꾸지 않습니다.
 * 관리자가 교회 계정을 만들 때도 관리자 로그인은 유지됩니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.identity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createClient(options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error("Firebase API 키가 없습니다.");
    if (typeof fetchImpl !== "function") throw new Error("네트워크 요청을 보낼 수 없습니다.");

    async function post(method, body) {
      const res = await fetchImpl(
        `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = null;
      }
      if (!res.ok) {
        const message = data && data.error
          ? (data.error.message || data.error)
          : text;
        const err = new Error(typeof message === "string" ? message : "계정 요청에 실패했습니다.");
        err.code = data && data.error ? data.error.message : "";
        throw err;
      }
      return data || {};
    }

    return {
      async signUp(email, password) {
        const data = await post("signUp", {
          email,
          password,
          returnSecureToken: true,
        });
        if (!data.localId || !data.idToken) throw new Error("계정 생성 응답이 올바르지 않습니다.");
        return {
          localId: data.localId,
          email: data.email || email,
          idToken: data.idToken,
        };
      },
      async signIn(email, password) {
        const data = await post("signInWithPassword", {
          email,
          password,
          returnSecureToken: true,
        });
        if (!data.idToken) throw new Error("로그인 응답이 올바르지 않습니다.");
        return {
          localId: data.localId || "",
          email: data.email || email,
          idToken: data.idToken,
          refreshToken: data.refreshToken || "",
        };
      },
      async updateAccount(idToken, patch) {
        const body = { idToken, returnSecureToken: true };
        if (patch && patch.password) body.password = patch.password;
        if (patch && patch.email) body.email = patch.email;
        const data = await post("update", body);
        return {
          localId: data.localId || "",
          email: data.email || (patch && patch.email) || "",
          idToken: data.idToken || idToken,
        };
      },
      async deleteAccount(idToken) {
        await post("delete", { idToken });
      },
    };
  }

  return { createClient };
});
