(function () {
  var script = document.currentScript;
  var base = (script && script.src) ? script.src.replace(/[^/]+$/, "") : "";
  function fetchText(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText.trim());
        else reject(new Error("HTTP " + xhr.status + " " + url));
      };
      xhr.onerror = function () { reject(new Error("network " + url)); };
      xhr.send(null);
    });
  }
  function go(code) {
    var tag = document.createElement("script");
    tag.text = code;
    document.head.appendChild(tag);
  }
  Promise.all([
    fetchText(base + "renderer.payload.0.b64"),
    fetchText(base + "renderer.payload.1.b64"),
  ]).then(function (parts) {
    var b64 = parts.join("");
    var bin = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var ds = new DecompressionStream("gzip");
    var stream = new Blob([bin]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  }).then(function (buf) {
    go(new TextDecoder().decode(buf));
  }).catch(function (err) { console.error(err); });
})();
