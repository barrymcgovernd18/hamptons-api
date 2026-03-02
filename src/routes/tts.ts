import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { z } from "zod";

const ttsRouter = new Hono();

const ttsSchema = z.object({
  text: z.string().min(1).max(50000),
  voiceId: z.string().min(1),
  model_id: z.string().default("eleven_multilingual_v2"),
  voice_settings: z.object({
    stability: z.number().min(0).max(1).default(0.5),
    similarity_boost: z.number().min(0).max(1).default(0.75),
    style: z.number().min(0).max(1).default(0.0),
    use_speaker_boost: z.boolean().default(true),
  }).optional(),
});

ttsRouter.post("/speak", async (c) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return c.json({ error: "ElevenLabs API key not configured" }, 500);
  }

  try {
    const body = ttsSchema.parse(await c.req.json());

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${body.voiceId}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: body.text,
          model_id: body.model_id,
          voice_settings: body.voice_settings || {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TTS Proxy] ElevenLabs error:", response.status, errorText);
      return c.json(
        { error: `ElevenLabs API error: ${response.status}` },
        response.status as StatusCode,
      );
    }

    // Stream the audio response back
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    console.error("[TTS Proxy] Error:", error.message);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { ttsRouter };