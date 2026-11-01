import { readFile, writeFile } from "node:fs/promises";
const escape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
for (const [file, slug, title] of [
  ["PRIVACY", "privacy", "Privacy"],
  ["TERMS", "terms", "Terms"],
  ["SETUP", "setup", "Setup"],
]) {
  const text = await readFile(`docs/${file}.md`, "utf8");
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => {
      if (block.startsWith("# ")) return "";
      if (block.startsWith("## ")) return `<h2>${escape(block.slice(3))}</h2>`;
      if (block.startsWith("```"))
        return `<pre>${escape(block.replace(/^```[^\n]*\n/, "").replace(/\n```$/, ""))}</pre>`;
      return `<p>${escape(block).replace(/\n/g, " ")}</p>`;
    })
    .join("\n");
  await writeFile(
    `static/assets/${slug}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kept — ${title}</title><style>body{margin:0;font:16px/1.85 system-ui,sans-serif;color:#25314a;background:white}main{max-width:850px;margin:55px auto;padding:0 25px 50px}nav{border-bottom:1px solid #e1e7f1;padding-bottom:20px;display:flex;gap:20px}a{color:#234ee7}h1{font-size:40px;font-weight:550;letter-spacing:-1px}h2{font-size:24px;font-weight:550;margin-top:35px}p{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f5f7fd;border:1px solid #e2e8f7;font-size:13px}</style></head><body><main><nav><a href="./">Kept replay</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="setup.html">Setup</a></nav><h1>${title}</h1>${blocks}<p><a href="https://github.com/Marc-Dvci/kept/blob/main/docs/${file}.md">Source document and clickable references</a></p><p>Support: <a href="https://github.com/Marc-Dvci/kept/issues">Kept issue tracker</a>. Do not include sensitive customer records in public issues.</p></main></body></html>`,
  );
}
