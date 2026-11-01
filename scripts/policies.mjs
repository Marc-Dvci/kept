import { readFile, writeFile } from "node:fs/promises";
const escape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const inline = (text) => {
  let result = "",
    offset = 0;
  for (const token of text.matchAll(
    /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g,
  )) {
    result += escape(text.slice(offset, token.index));
    if (token[1]) {
      const target = /^(PRIVACY|TERMS|SETUP)\.md$/.test(token[2])
        ? token[2].replace(".md", ".html").toLowerCase()
        : /^https?:\/\//.test(token[2])
          ? token[2]
          : `https://github.com/Marc-Dvci/kept/blob/main/docs/${token[2]}`;
      result += `<a href="${escape(target)}">${escape(token[1])}</a>`;
    } else if (token[3]) result += `<code>${escape(token[3])}</code>`;
    else result += `<strong>${escape(token[4])}</strong>`;
    offset = token.index + token[0].length;
  }
  return result + escape(text.slice(offset));
};
const render = (markdown) => {
  const output = [],
    paragraph = [],
    code = [],
    list = [];
  let fenced = false,
    listType = "";
  const flushParagraph = () => {
    if (paragraph.length)
      output.push(`<p>${inline(paragraph.splice(0).join(" "))}</p>`);
  };
  const flushList = () => {
    if (list.length)
      output.push(
        `<${listType}>${list
          .splice(0)
          .map((item) => `<li>${inline(item)}</li>`)
          .join("")}</${listType}>`,
      );
    listType = "";
  };
  for (const line of markdown.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (fenced)
        output.push(
          `<pre><code>${escape(code.splice(0).join("\n"))}</code></pre>`,
        );
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      flushParagraph();
      flushList();
      if (heading[1].length > 1)
        output.push(
          `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`,
        );
      continue;
    }
    const item = line.match(/^(\d+\.|[-*])\s+(.+)/);
    if (item) {
      flushParagraph();
      const type = /^\d/.test(item[1]) ? "ol" : "ul";
      if (listType && type !== listType) flushList();
      listType = type;
      list.push(item[2]);
      continue;
    }
    if (list.length && /^\s{2,}/.test(line))
      list[list.length - 1] += ` ${line.trim()}`;
    else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return output.join("\n");
};
for (const [file, slug, title] of [
  ["PRIVACY", "privacy", "Privacy"],
  ["TERMS", "terms", "Terms"],
  ["SETUP", "setup", "Setup"],
]) {
  const text = await readFile(`docs/${file}.md`, "utf8");
  const blocks = render(text);
  await writeFile(
    `static/assets/${slug}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kept : ${title}</title><style>body{margin:0;font:16px/1.85 system-ui,sans-serif;color:#25314a;background:white}main{max-width:850px;margin:55px auto;padding:0 25px 50px}nav{border-bottom:1px solid #e1e7f1;padding-bottom:20px;display:flex;gap:20px}a{color:#234ee7}h1{font-size:40px;font-weight:550;letter-spacing:-1px}h2{font-size:24px;font-weight:550;margin-top:35px}p{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f5f7fd;border:1px solid #e2e8f7;font-size:13px}</style></head><body><main><nav><a href="./">Kept replay</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="setup.html">Setup</a></nav><h1>${title}</h1>${blocks}<p><a href="https://github.com/Marc-Dvci/kept/blob/main/docs/${file}.md">Source document and clickable references</a></p><p>Support: <a href="https://github.com/Marc-Dvci/kept/issues">Kept issue tracker</a>. Do not include sensitive customer records in public issues.</p></main></body></html>`,
  );
}
