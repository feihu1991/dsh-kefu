import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync(new URL("../server/public/", import.meta.url), { recursive: true });
copyFileSync(new URL("./widget.html", import.meta.url), new URL("../server/public/widget.html", import.meta.url));
copyFileSync(new URL("./kefu-sdk.js", import.meta.url), new URL("../server/public/kefu-sdk.js", import.meta.url));
copyFileSync(new URL("./sdk-demo.html", import.meta.url), new URL("../server/public/sdk-demo.html", import.meta.url));
console.log("widget.html / kefu-sdk.js / sdk-demo.html copied to server/public");
