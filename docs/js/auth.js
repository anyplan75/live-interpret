/**
 * 관리자 한 명. 첫 방문에서만 계정을 만들고, 이후 가입은 거절합니다.
 */
window.LI = window.LI || {};

LI.auth = (() => {
  let busy = false;

  function auth() {
    return firebase.auth();
  }

  async function existingUid() {
    LI.db.clearChurch();
    const value = await LI.db.get(LI.catalog.adminUidRel);
    return typeof value === "string" ? value : "";
  }

  async function status() {
    await LI.db.init();
    const uid = await existingUid();
    return { hasAdmin: !LI.catalog.canClaimAdmin(uid), uid };
  }

  async function rejectIfNotAdmin(user) {
    const uid = await existingUid();
    if (!LI.catalog.isCurrentAdmin(uid, user.uid)) {
      await auth().signOut();
      throw new Error("이 계정은 관리자가 아닙니다.");
    }
    return user;
  }

  async function signIn(email, password) {
    busy = true;
    try {
      await LI.db.init();
      if (!LI.catalog.validAdminEmail(email) || !LI.catalog.validAdminPassword(password)) {
        throw new Error("이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.");
      }
      const cred = await auth().signInWithEmailAndPassword(email.trim(), password);
      return await rejectIfNotAdmin(cred.user);
    } finally {
      busy = false;
    }
  }

  async function signUp(email, password) {
    busy = true;
    try {
      await LI.db.init();
      if (!LI.catalog.validAdminEmail(email) || !LI.catalog.validAdminPassword(password)) {
        throw new Error("이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.");
      }
      const uid = await existingUid();
      if (!LI.catalog.canClaimAdmin(uid)) {
        throw new Error("관리자 계정이 이미 있습니다. 그 계정으로 로그인하세요.");
      }
      const cred = await auth().createUserWithEmailAndPassword(email.trim(), password);
      const claim = await LI.db.transaction(LI.catalog.adminUidRel, (current) => {
        if (!LI.catalog.canClaimAdmin(current)) return;
        return cred.user.uid;
      });
      if (!claim.committed || claim.value !== cred.user.uid) {
        try { await cred.user.delete(); } catch (_) { /* 이미 지워진 가입은 무시합니다 */ }
        await auth().signOut();
        throw new Error("관리자 계정이 이미 있습니다. 그 계정으로 로그인하세요.");
      }
      return cred.user;
    } finally {
      busy = false;
    }
  }

  function signOut() {
    return auth().signOut();
  }

  function onUser(callback) {
    return auth().onAuthStateChanged(callback);
  }

  return {
    status,
    signIn,
    signUp,
    signOut,
    onUser,
    existingUid,
    isBusy() { return busy; },
  };
})();
