import { PlatformAdapter } from './types.ts'
import { instagram } from './instagram.ts'
import { facebook } from './facebook.ts'
import { threads } from './threads.ts'
import { youtube } from './youtube.ts'
import { tiktok } from './tiktok.ts'

// Ajouter une plateforme : une entree ici, plus le fichier d'adapter. C'est tout.
export const ADAPTERS: Record<string, PlatformAdapter> = {
  instagram,
  facebook,
  threads,
  youtube,
  tiktok,
}

export function adapterFor(platform: string): PlatformAdapter {
  const adapter = ADAPTERS[platform]
  if (!adapter) throw new Error(`Plateforme inconnue : ${platform}`)
  return adapter
}

export * from './types.ts'
