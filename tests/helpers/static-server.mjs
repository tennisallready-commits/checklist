import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

export async function startStaticServer(rootDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const resolvedPath = normalize(join(rootDirectory, relativePath));
      if (!resolvedPath.startsWith(normalize(rootDirectory))) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const fileStat = await stat(resolvedPath);
      const filePath = fileStat.isDirectory() ? join(resolvedPath, "index.html") : resolvedPath;
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(body);
    } catch (_) {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
