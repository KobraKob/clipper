import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const appRoot = path.resolve("src/app");
const componentRoot = path.resolve("src/components");
const siteFramePath = path.join(componentRoot, "SiteFrame.tsx");

test("site navigation and footer targets resolve to application routes", () => {
  const source = fs.readFileSync(siteFramePath, "utf8");
  const hrefs = [...source.matchAll(/href="(\\/[^"]*)"/g)].map((match) => match[1]);
  const expected = ["/", "/library", "/calendar", "/privacy", "/terms", "/cookies"];

  for (const href of expected) {
    assert.ok(hrefs.includes(href), "Missing navigation target: " + href);
  }

  for (const href of hrefs) {
    const route = href.split("#")[0].split("?")[0] || "/";
    const routeFile = route === "/"
      ? path.join(appRoot, "page.tsx")
      : path.join(appRoot, route.slice(1), "page.tsx");
    assert.ok(fs.existsSync(routeFile), "Broken static route link: " + href);
  }
});

test("the custom favicon is present in the App Router", () => {
  assert.ok(fs.existsSync(path.join(appRoot, "favicon.ico")));
});

test("404, route error, and loading fallbacks are present", () => {
  assert.ok(fs.existsSync(path.join(appRoot, "not-found.tsx")));
  assert.ok(fs.existsSync(path.join(appRoot, "error.tsx")));
  assert.ok(fs.existsSync(path.join(appRoot, "loading.tsx")));
});

test("reviewed frontend copy contains no Lorem Ipsum placeholder", () => {
  const roots = [appRoot, componentRoot];
  const pending = [...roots];
  const files = [];

  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (/\\.(tsx|ts|css)$/.test(entry.name)) files.push(fullPath);
    }
  }

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(content, /Lorem\\s+ipsum/i, "Placeholder found in " + file);
  }
});
