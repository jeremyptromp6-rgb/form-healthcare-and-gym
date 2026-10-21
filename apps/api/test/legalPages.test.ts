import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { makeApp, testConfig } from "./helpers";

type Made = Awaited<ReturnType<typeof makeApp>>;
let made: Made | undefined;
afterEach(async () => {
  await made?.app.close();
  made = undefined;
});

const get = async (url: string, config: Parameters<typeof makeApp>[0] = {}) => {
  await made?.app.close();
  made = await makeApp(config);
  return made.app.inject({ method: "GET", url });
};

describe("public legal pages", () => {
  it.each([
    ["/privacy", ["What FORM collects and why", "Health Connect", "7 days", "Children", "not directed to children under 13", "/delete-account"]],
    ["/delete-account", ["Privacy center", "Delete my account", "progress photos", "within 7 days"]],
    ["/terms", ["Not medical advice", "FORM Pro", "at least 13"]],
  ])("serves %s as HTML without signing in", async (url, phrases) => {
    const res = await get(url);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body.startsWith("<!doctype html>")).toBe(true);
    expect(res.body).toContain('<html lang="en">');
    expect(res.body).toContain("<h1>");
    for (const p of phrases) expect(res.body).toContain(p);
  });

  it("is cache-friendly, cookie-free and keeps the strict headers (CSP allows only its own style by hash)", async () => {
    const res = await get("/privacy");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/]+=*'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.body).not.toMatch(/<script|<img|<link|https?:\/\/[^"' ]+\.(js|css|png)/i);
  });

  it("leaves the JSON API's no-store and default-src 'none' alone", async () => {
    const res = await get("/health");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("shows the contact email only when SUPPORT_EMAIL is configured", async () => {
    for (const url of ["/privacy", "/delete-account", "/terms"]) {
      const without = await get(url);
      expect(without.body).not.toContain("mailto:");
      expect(without.body).toContain("store listing");
      const withEmail = await get(url, { config: { supportEmail: "help@form.example" } });
      expect(withEmail.body).toContain('href="mailto:help@form.example"');
      expect(withEmail.body).not.toContain("store listing");
    }
  });

  it("escapes the configured email", async () => {
    const res = await get("/terms", { config: { supportEmail: '"><b>x</b>@e.co' } });
    expect(res.body).not.toContain("<b>x</b>");
  });

  it("names meal-photo and coach processors only when they are configured", async () => {
    const off = await get("/privacy");
    expect(off.body).not.toContain("Gemini");
    expect(off.body).not.toContain("Cloudflare");
    expect(off.body).toContain("not switched on");

    const on = await get("/privacy", { config: { backup: "litestream", foodRecognition: { ...testConfig.foodRecognition, provider: "gemini" } } });
    expect(on.body).toContain("Google (Gemini API)");
    expect(on.body).toContain("does not store the photo");
    expect(on.body).toContain("Cloudflare R2");

    const ai = await get("/privacy", { config: { coach: { ...testConfig.coach, provider: "anthropic" } } });
    expect(ai.body).toContain("Anthropic");
  });

  it("reads SUPPORT_EMAIL from the environment; blank counts as unset, junk is refused", () => {
    expect(loadConfig({ NODE_ENV: "test", SUPPORT_EMAIL: " help@form.example " } as never).supportEmail).toBe("help@form.example");
    expect(loadConfig({ NODE_ENV: "test", SUPPORT_EMAIL: "  " } as never).supportEmail).toBeNull();
    expect(loadConfig({ NODE_ENV: "test" } as never).supportEmail).toBeNull();
    expect(() => loadConfig({ NODE_ENV: "test", SUPPORT_EMAIL: "not-an-email" } as never)).toThrow(/SUPPORT_EMAIL/);
  });
});
