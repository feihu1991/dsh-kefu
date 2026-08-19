import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync(new URL("../server/public/", import.meta.url), { recursive: true });
copyFileSync(new URL("./widget.html", import.meta.url), new URL("../server/public/widget.html", import.meta.url));
console.log("widget.html copied to server/public");
