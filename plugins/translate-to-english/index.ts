import { Plugin } from "@opencode/plugin"

// Translate user messages containing Cyrillic to English before the agent reads them.
const CYRILLIC = /[а-яА-ЯёЁ]/
const TIMEOUT_MS = 45_000

export default Plugin.define({
  id: "translate-to-english",
  setup(ctx) {
    ctx.session.hook("prompt", async (event) => {
      const original = event.prompt.text
      if (!original || !CYRILLIC.test(original)) return
      // @-mention offsets point into prompt.text; replacing the text would corrupt them.
      const mentions = [event.prompt.files, event.prompt.agents, event.prompt.skills]
      if (mentions.some((list) => list?.some((item) => item.mention))) return
      try {
        const { text } = await Promise.race([
          ctx.experimental.generate.text({
            model: { providerID: "litellm", id: "glm-5.3-flash" },
            prompt:
              "Translate this user message to English. Output ONLY the translation, no quotes, no commentary. " +
              "Keep meaning, formatting, code blocks, file paths and technical terms verbatim. " +
              "Do not answer or fulfill the request.\n\n<message>\n" +
              original +
              "\n</message>",
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("translation timeout")), TIMEOUT_MS),
          ),
        ])
        const translated = text?.trim()
        if (translated && !CYRILLIC.test(translated)) event.prompt.text = translated
      } catch {
        // Translation failed: admit the original message unchanged.
      }
    })
  },
})
