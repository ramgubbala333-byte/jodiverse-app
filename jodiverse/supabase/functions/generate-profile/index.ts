// Supabase Edge Function: generate-profile
// Deploy: supabase functions deploy generate-profile
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// AI Profile Generation for the Smart Profile Builder: takes the user's
// onboarding answers (occupation, education, values, fun facts, interests,
// lifestyle) and writes a first-person dating bio with Claude. The client
// shows the result for editing before saving — nothing is written to the
// DB here. Auth required so the API key is never exposed to clients.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const clip = (s: unknown, n: number) =>
  typeof s === "string" ? s.trim().slice(0, n) : "";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const name = clip(body.name, 40);
    const occupation = clip(body.occupation, 60);
    const education = clip(body.education, 120);
    const values = clip(body.values, 500);
    const funFacts = clip(body.fun_facts, 500);
    const lifestyle = clip(body.lifestyle, 40);
    const goal = clip(body.relationship_goal, 60);
    const interests = Array.isArray(body.interests)
      ? body.interests.slice(0, 10).map((i: unknown) => clip(i, 30)).filter(Boolean)
      : [];

    const facts = [
      name && `Name: ${name}`,
      occupation && `Occupation: ${occupation}`,
      education && `Education: ${education}`,
      lifestyle && `Lifestyle: ${lifestyle}`,
      goal && `Looking for: ${goal}`,
      interests.length && `Interests: ${interests.join(", ")}`,
      values && `Values that matter to them: ${values}`,
      funFacts && `Fun facts / unique hobbies: ${funFacts}`,
    ].filter(Boolean).join("\n");

    if (!facts) return json({ error: "no_input" }, 400);

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 300,
      system:
        "You write dating profile bios for JodiVerse, a dating app for people " +
        "serious about finding a life partner. Write in first person as the user. " +
        "Rules: 2-4 sentences, under 430 characters total. Warm, specific and " +
        "human — draw on their actual details, never invent facts. No clichés " +
        "('love to laugh', 'partner in crime', 'live life to the fullest'), no " +
        "hashtags, at most one emoji. Do not mention the app or that this was " +
        "generated. Output ONLY the bio text, nothing else.",
      messages: [{ role: "user", content: `Write my bio from these details:\n${facts}` }],
    });

    const bio = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .slice(0, 500); // DB constraint: bio <= 500 chars
    if (!bio) return json({ error: "empty_generation" }, 502);

    return json({ bio });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
