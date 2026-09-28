/**
 * Firebase Realtime Database.
 * 모든 경로는 live-interpret 아래만 허용하고 cheil, jifc 는 거부합니다.
 */
window.LI = window.LI || {};

LI.db = (() => {
  let database = null;
  let churchLive = "";

  function fullRel(rel) {
    const clean = String(rel || "").replace(/^\/+|\/+$/g, "");
    const scoped = churchLive && clean && !clean.startsWith("churches/")
      ? `${churchLive}/${clean}`
      : clean;
    return LI.catalog.underRoot(scoped);
  }

  function init() {
    if (database) return Promise.resolve();
    if (typeof firebase === "undefined") {
      return Promise.reject(new Error("Firebase SDK가 로드되지 않았습니다."));
    }
    if (!firebase.apps.length) {
      firebase.initializeApp({ databaseURL: LI.catalog.firebase.databaseURL });
    }
    database = firebase.database();
    return Promise.resolve();
  }

  function ref(rel) {
    return database.ref(fullRel(rel));
  }

  function onValue(rel, callback, errorCallback) {
    const node = ref(rel);
    const handler = (snap) => callback(snap.val());
    node.on("value", handler, errorCallback || (() => {}));
    return () => node.off("value", handler);
  }

  return {
    init,
    useChurch(id) {
      if (!LI.catalog.isChurchId(id)) throw new Error("교회 링크가 올바르지 않습니다.");
      churchLive = `churches/${id}/live`;
    },
    clearChurch() {
      churchLive = "";
    },
    get(rel) {
      return ref(rel).once("value").then((snap) => snap.val());
    },
    set(rel, value) {
      return ref(rel).set(value);
    },
    update(rel, value) {
      return ref(rel).update(value);
    },
    onValue,
  };
})();
