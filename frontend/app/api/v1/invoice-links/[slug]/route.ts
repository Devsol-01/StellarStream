import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const slug = (await params).slug;
  if (!slug) {
    return NextResponse.json({ error: "Missing invoice link identifier." }, { status: 400 });
  }

  const upstream = await fetch(
    `${BACKEND}/api/v1/invoice-links/${encodeURIComponent(slug)}`,
  ).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 502 });
  }

  const body = await upstream.json();
  return NextResponse.json(body, { status: upstream.status });
}
