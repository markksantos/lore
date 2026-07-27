import { fail, requireVault } from "@/lib/server";
import { issueToken, readTokens, revokeToken, type Role } from "@/lib/access";
import { recordActivity } from "@/lib/collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["reader", "writer", "admin"];

/** GET — every issued token, without the tokens. */
export async function GET() {
  try {
    const vault = await requireVault();
    const tokens = await readTokens(vault.root);
    return Response.json({
      // `hash` is deliberately not returned. It is not the token, but it is the
      // only thing an attacker would need to compare against a guess offline.
      tokens: tokens.map(({ hash: _hash, ...rest }) => rest),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** POST — issue a token. The plaintext is in this response and nowhere else. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { name?: string; role?: string; scopes?: string[] };
    const role = ROLES.includes(body.role as Role) ? (body.role as Role) : "reader";

    const { record, token } = await issueToken(
      vault.root,
      body.name ?? "",
      role,
      body.scopes ?? [],
    );
    await recordActivity(vault.root, {
      kind: "verified",
      by: "me",
      pageId: null,
      relPath: null,
      detail: `issued ${role} token for ${record.name}`,
    });

    return Response.json({
      ok: true,
      token,
      // Said plainly, because there is no recovery path and the user has to act
      // on it now rather than discover it later.
      warning: "This token is shown once. It is stored hashed and cannot be retrieved again.",
      record: { ...record, hash: undefined },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const vault = await requireVault();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail(new Error("Missing ?id"));
    await revokeToken(vault.root, id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
