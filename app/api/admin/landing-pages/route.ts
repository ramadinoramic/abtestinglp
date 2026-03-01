import { NextResponse } from 'next/server';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const landingPagesDir = join(process.cwd(), 'public', 'landing-pages');

    const folders = readdirSync(landingPagesDir).filter((name) => {
      const fullPath = join(landingPagesDir, name);
      return statSync(fullPath).isDirectory();
    });

    return NextResponse.json({ landingPages: folders });
  } catch {
    return NextResponse.json({ landingPages: [] });
  }
}
