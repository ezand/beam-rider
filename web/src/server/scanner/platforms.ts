/**
 * The platforms the ROM scanner knows: how to recognize their folders and
 * files, and which reference lists (DATs) identify their games. Adding a
 * platform means adding an entry here.
 *
 * - `slug` is the platform's id in BeamRider, and `name`, `maker` and `year`
 *   are what its card shows. Names are the short ones people use (SNES,
 *   PlayStation), to fit on a card.
 * - `folders` are folder names that mean this platform, compared ignoring
 *   case and punctuation: RetroPie/ES-DE short names, plus the slug, the name,
 *   the DAT names and the providers' names (such as LaunchBox's "Super
 *   Nintendo Entertainment System"), which are always accepted.
 * - `dats` are paths in libretro-database's metadat folder (No-Intro for
 *   cartridges and computers, Redump for discs).
 * - `kind`: cartridge games are one file and are identified by checksum;
 *   disc images are large, so they're identified by name.
 * - `header`, if set, is a copier or emulator header to remove before
 *   hashing, when present. libretro's NES DAT lists both headered and
 *   headerless dumps, so NES needs none.
 * - `providers` are the platform's ids at metadata providers, for the
 *   scraper: its LaunchBox Games Database name and ScreenScraper system id
 *   (from frontend/scripts/scraper/screenscraper.gd).
 */

export type PlatformKind = "cartridge" | "disc" | "computer" | "arcade";

export type Header = {
  bytes: number;
  /** Whether a file of `size` bytes starting with `start` has this header. */
  detect: (start: Uint8Array, size: number) => boolean;
};

export type PlatformInfo = {
  slug: string;
  name: string;
  maker: string | null;
  year: number | null;
  folders: string[];
  dats: string[];
  extensions: string[];
  kind: PlatformKind;
  header?: Header;
  providers: { launchbox?: string; screenscraper?: number };
  /** Recognized, but not scanned yet. */
  unsupported?: string;
};

const startsWith = (start: Uint8Array, text: string, offset = 0) =>
  [...text].every((char, i) => start[offset + i] === char.charCodeAt(0));

const HEADERS = {
  /** Super Magicom / Super Wild Card copier header, on files of 1 KB blocks plus 512. */
  snesCopier: { bytes: 512, detect: (_start, size) => size % 1024 === 512 },
  atari7800: { bytes: 128, detect: (start) => startsWith(start, "ATARI7800", 1) },
  lynx: { bytes: 64, detect: (start) => startsWith(start, "LYNX") },
  fds: { bytes: 16, detect: (start) => startsWith(start, "FDS\x1a") },
} satisfies Record<string, Header>;

const noIntro = (name: string) => `no-intro/${name}.dat`;
const redump = (name: string) => `redump/${name}.dat`;

/** Disc image formats, besides the ones a platform adds. */
const DISC = ["cue", "chd", "iso", "m3u"];

export const PLATFORMS: PlatformInfo[] = [
  // Nintendo
  { slug: "nes", name: "NES", maker: "Nintendo", year: 1983, folders: ["nes", "famicom", "fc"], dats: [noIntro("Nintendo - Nintendo Entertainment System")], extensions: ["nes", "unf", "unif"], kind: "cartridge", providers: { launchbox: "Nintendo Entertainment System", screenscraper: 3 } },
  { slug: "fds", name: "Famicom Disk System", maker: "Nintendo", year: 1986, folders: ["fds", "famicomdisksystem"], dats: [noIntro("Nintendo - Family Computer Disk System")], extensions: ["fds"], kind: "cartridge", header: HEADERS.fds, providers: { launchbox: "Nintendo Famicom Disk System", screenscraper: 106 } },
  { slug: "snes", name: "SNES", maker: "Nintendo", year: 1990, folders: ["snes", "sfc", "superfamicom", "supernintendo"], dats: [noIntro("Nintendo - Super Nintendo Entertainment System")], extensions: ["sfc", "smc", "swc", "fig"], kind: "cartridge", header: HEADERS.snesCopier, providers: { launchbox: "Super Nintendo Entertainment System", screenscraper: 4 } },
  { slug: "satellaview", name: "Satellaview", maker: "Nintendo", year: 1995, folders: ["satellaview", "bsx"], dats: [noIntro("Nintendo - Satellaview")], extensions: ["bs", "sfc"], kind: "cartridge", providers: { launchbox: "Nintendo Satellaview" } },
  { slug: "n64", name: "Nintendo 64", maker: "Nintendo", year: 1996, folders: ["n64"], dats: [noIntro("Nintendo - Nintendo 64")], extensions: ["z64", "n64", "v64"], kind: "cartridge", providers: { launchbox: "Nintendo 64", screenscraper: 14 } },
  { slug: "n64dd", name: "64DD", maker: "Nintendo", year: 1999, folders: ["n64dd"], dats: [noIntro("Nintendo - Nintendo 64DD")], extensions: ["ndd"], kind: "cartridge", providers: { launchbox: "Nintendo 64DD" } },
  { slug: "gb", name: "Game Boy", maker: "Nintendo", year: 1989, folders: ["gb", "gameboy"], dats: [noIntro("Nintendo - Game Boy")], extensions: ["gb"], kind: "cartridge", providers: { launchbox: "Nintendo Game Boy", screenscraper: 9 } },
  { slug: "gbc", name: "Game Boy Color", maker: "Nintendo", year: 1998, folders: ["gbc", "gameboycolor"], dats: [noIntro("Nintendo - Game Boy Color")], extensions: ["gbc", "gb"], kind: "cartridge", providers: { launchbox: "Nintendo Game Boy Color", screenscraper: 10 } },
  { slug: "gba", name: "Game Boy Advance", maker: "Nintendo", year: 2001, folders: ["gba", "gameboyadvance"], dats: [noIntro("Nintendo - Game Boy Advance")], extensions: ["gba"], kind: "cartridge", providers: { launchbox: "Nintendo Game Boy Advance", screenscraper: 12 } },
  { slug: "nds", name: "Nintendo DS", maker: "Nintendo", year: 2004, folders: ["nds", "ds"], dats: [noIntro("Nintendo - Nintendo DS")], extensions: ["nds"], kind: "cartridge", providers: { launchbox: "Nintendo DS", screenscraper: 15 } },
  { slug: "virtualboy", name: "Virtual Boy", maker: "Nintendo", year: 1995, folders: ["virtualboy", "vb"], dats: [noIntro("Nintendo - Virtual Boy")], extensions: ["vb", "vboy"], kind: "cartridge", providers: { launchbox: "Nintendo Virtual Boy", screenscraper: 11 } },
  { slug: "pokemini", name: "Pokémon Mini", maker: "Nintendo", year: 2001, folders: ["pokemini", "pokemonmini"], dats: [noIntro("Nintendo - Pokemon Mini")], extensions: ["min"], kind: "cartridge", providers: { launchbox: "Nintendo Pokemon Mini" } },
  { slug: "gc", name: "GameCube", maker: "Nintendo", year: 2001, folders: ["gc", "gamecube", "ngc"], dats: [redump("Nintendo - GameCube")], extensions: ["iso", "gcm", "rvz", "ciso", "gcz", "m3u"], kind: "disc", providers: { launchbox: "Nintendo GameCube", screenscraper: 13 } },
  { slug: "wii", name: "Wii", maker: "Nintendo", year: 2006, folders: ["wii"], dats: [redump("Nintendo - Wii")], extensions: ["iso", "wbfs", "rvz", "wia", "ciso"], kind: "disc", providers: { launchbox: "Nintendo Wii", screenscraper: 16 } },

  // Sega
  { slug: "sg-1000", name: "SG-1000", maker: "Sega", year: 1983, folders: ["sg-1000", "sg1000"], dats: [noIntro("Sega - SG-1000")], extensions: ["sg"], kind: "cartridge", providers: { launchbox: "Sega SG-1000", screenscraper: 109 } },
  { slug: "mastersystem", name: "Master System", maker: "Sega", year: 1986, folders: ["mastersystem", "sms", "markiii"], dats: [noIntro("Sega - Master System - Mark III")], extensions: ["sms"], kind: "cartridge", providers: { launchbox: "Sega Master System", screenscraper: 2 } },
  { slug: "megadrive", name: "Mega Drive", maker: "Sega", year: 1989, folders: ["megadrive", "genesis", "md", "segagenesis", "segamegadrive"], dats: [noIntro("Sega - Mega Drive - Genesis")], extensions: ["md", "gen", "bin"], kind: "cartridge", providers: { launchbox: "Sega Genesis", screenscraper: 1 } },
  { slug: "gamegear", name: "Game Gear", maker: "Sega", year: 1990, folders: ["gamegear", "gg"], dats: [noIntro("Sega - Game Gear")], extensions: ["gg"], kind: "cartridge", providers: { launchbox: "Sega Game Gear", screenscraper: 21 } },
  { slug: "sega32x", name: "32X", maker: "Sega", year: 1994, folders: ["sega32x", "32x"], dats: [noIntro("Sega - 32X")], extensions: ["32x"], kind: "cartridge", providers: { launchbox: "Sega 32X" } },
  { slug: "pico", name: "Pico", maker: "Sega", year: 1993, folders: ["pico", "segapico"], dats: [noIntro("Sega - PICO")], extensions: ["md", "bin"], kind: "cartridge", providers: { launchbox: "Sega Pico" } },
  { slug: "segacd", name: "Mega-CD", maker: "Sega", year: 1991, folders: ["segacd", "megacd"], dats: [redump("Sega - Mega-CD - Sega CD")], extensions: DISC, kind: "disc", providers: { launchbox: "Sega CD", screenscraper: 20 } },
  { slug: "saturn", name: "Saturn", maker: "Sega", year: 1994, folders: ["saturn", "segasaturn"], dats: [redump("Sega - Saturn")], extensions: [...DISC, "ccd"], kind: "disc", providers: { launchbox: "Sega Saturn", screenscraper: 22 } },
  { slug: "dreamcast", name: "Dreamcast", maker: "Sega", year: 1998, folders: ["dreamcast", "dc"], dats: [redump("Sega - Dreamcast")], extensions: ["gdi", "chd", "cdi", "m3u"], kind: "disc", providers: { launchbox: "Sega Dreamcast", screenscraper: 23 } },

  // Sony
  { slug: "psx", name: "PlayStation", maker: "Sony", year: 1994, folders: ["psx", "ps1", "playstation"], dats: [redump("Sony - PlayStation")], extensions: [...DISC, "pbp"], kind: "disc", providers: { launchbox: "Sony Playstation", screenscraper: 57 } },
  { slug: "ps2", name: "PlayStation 2", maker: "Sony", year: 2000, folders: ["ps2", "playstation2"], dats: [redump("Sony - PlayStation 2")], extensions: [...DISC, "cso"], kind: "disc", providers: { launchbox: "Sony Playstation 2", screenscraper: 58 } },
  { slug: "psp", name: "PSP", maker: "Sony", year: 2004, folders: ["psp", "playstationportable"], dats: [redump("Sony - PlayStation Portable"), noIntro("Sony - PlayStation Portable")], extensions: ["iso", "cso", "chd", "pbp"], kind: "disc", providers: { launchbox: "Sony PSP", screenscraper: 61 } },

  // NEC, SNK, 3DO
  { slug: "pcengine", name: "PC Engine", maker: "NEC", year: 1989, folders: ["pcengine", "pce", "tg16", "turbografx16", "turbografx"], dats: [noIntro("NEC - PC Engine - TurboGrafx 16")], extensions: ["pce"], kind: "cartridge", providers: { launchbox: "NEC TurboGrafx-16", screenscraper: 31 } },
  { slug: "supergrafx", name: "SuperGrafx", maker: "NEC", year: 1989, folders: ["supergrafx", "sgx"], dats: [noIntro("NEC - PC Engine SuperGrafx")], extensions: ["sgx", "pce"], kind: "cartridge", providers: { launchbox: "PC Engine SuperGrafx" } },
  { slug: "pcenginecd", name: "PC Engine CD", maker: "NEC", year: 1989, folders: ["pcenginecd", "pcecd", "tg-cd", "tgcd", "turbografxcd"], dats: [redump("NEC - PC Engine CD - TurboGrafx-CD")], extensions: DISC, kind: "disc", providers: { launchbox: "NEC TurboGrafx-CD" } },
  { slug: "pcfx", name: "PC-FX", maker: "NEC", year: 1994, folders: ["pcfx"], dats: [redump("NEC - PC-FX")], extensions: DISC, kind: "disc", providers: { launchbox: "NEC PC-FX", screenscraper: 72 } },
  { slug: "ngp", name: "Neo Geo Pocket", maker: "SNK", year: 1998, folders: ["ngp", "neogeopocket"], dats: [noIntro("SNK - Neo Geo Pocket")], extensions: ["ngp"], kind: "cartridge", providers: { launchbox: "SNK Neo Geo Pocket", screenscraper: 25 } },
  { slug: "ngpc", name: "Neo Geo Pocket Color", maker: "SNK", year: 1999, folders: ["ngpc", "neogeopocketcolor"], dats: [noIntro("SNK - Neo Geo Pocket Color")], extensions: ["ngc", "ngpc"], kind: "cartridge", providers: { launchbox: "SNK Neo Geo Pocket Color" } },
  { slug: "neogeocd", name: "Neo Geo CD", maker: "SNK", year: 1994, folders: ["neogeocd"], dats: [redump("SNK - Neo Geo CD")], extensions: DISC, kind: "disc", providers: { launchbox: "SNK Neo Geo CD" } },
  { slug: "3do", name: "3DO", maker: "The 3DO Company", year: 1993, folders: ["3do"], dats: [redump("The 3DO Company - 3DO")], extensions: DISC, kind: "disc", providers: { launchbox: "3DO Interactive Multiplayer", screenscraper: 29 } },

  // Atari
  { slug: "atari2600", name: "Atari 2600", maker: "Atari", year: 1977, folders: ["atari2600", "a2600", "vcs"], dats: [noIntro("Atari - 2600")], extensions: ["a26", "bin"], kind: "cartridge", providers: { launchbox: "Atari 2600", screenscraper: 26 } },
  { slug: "atari5200", name: "Atari 5200", maker: "Atari", year: 1982, folders: ["atari5200", "a5200"], dats: [noIntro("Atari - 5200")], extensions: ["a52", "bin"], kind: "cartridge", providers: { launchbox: "Atari 5200", screenscraper: 40 } },
  { slug: "atari7800", name: "Atari 7800", maker: "Atari", year: 1986, folders: ["atari7800", "a7800"], dats: [noIntro("Atari - 7800")], extensions: ["a78", "bin"], kind: "cartridge", header: HEADERS.atari7800, providers: { launchbox: "Atari 7800", screenscraper: 41 } },
  { slug: "atarilynx", name: "Lynx", maker: "Atari", year: 1989, folders: ["atarilynx", "lynx"], dats: [noIntro("Atari - Lynx")], extensions: ["lnx", "lyx"], kind: "cartridge", header: HEADERS.lynx, providers: { launchbox: "Atari Lynx" } },
  { slug: "atarijaguar", name: "Jaguar", maker: "Atari", year: 1993, folders: ["atarijaguar", "jaguar"], dats: [noIntro("Atari - Jaguar")], extensions: ["j64", "jag", "rom"], kind: "cartridge", providers: { launchbox: "Atari Jaguar" } },
  { slug: "atarijaguarcd", name: "Jaguar CD", maker: "Atari", year: 1995, folders: ["atarijaguarcd", "jaguarcd"], dats: [redump("Atari - Jaguar CD")], extensions: DISC, kind: "disc", providers: { launchbox: "Atari Jaguar CD" } },

  // Other consoles and handhelds
  { slug: "wonderswan", name: "WonderSwan", maker: "Bandai", year: 1999, folders: ["wonderswan", "ws"], dats: [noIntro("Bandai - WonderSwan")], extensions: ["ws"], kind: "cartridge", providers: { launchbox: "WonderSwan", screenscraper: 45 } },
  { slug: "wonderswancolor", name: "WonderSwan Color", maker: "Bandai", year: 2000, folders: ["wonderswancolor", "wsc"], dats: [noIntro("Bandai - WonderSwan Color")], extensions: ["wsc"], kind: "cartridge", providers: { launchbox: "WonderSwan Color" } },
  { slug: "coleco", name: "ColecoVision", maker: "Coleco", year: 1982, folders: ["coleco", "colecovision"], dats: [noIntro("Coleco - ColecoVision")], extensions: ["col", "rom"], kind: "cartridge", providers: { launchbox: "ColecoVision", screenscraper: 48 } },
  { slug: "intellivision", name: "Intellivision", maker: "Mattel", year: 1979, folders: ["intellivision", "intv"], dats: [noIntro("Mattel - Intellivision")], extensions: ["int", "bin", "rom"], kind: "cartridge", providers: { launchbox: "Mattel Intellivision", screenscraper: 115 } },
  { slug: "vectrex", name: "Vectrex", maker: "GCE", year: 1982, folders: ["vectrex"], dats: [noIntro("GCE - Vectrex")], extensions: ["vec", "bin"], kind: "cartridge", providers: { launchbox: "GCE Vectrex", screenscraper: 102 } },
  { slug: "odyssey2", name: "Odyssey 2", maker: "Magnavox", year: 1978, folders: ["odyssey2", "videopac", "o2em"], dats: [noIntro("Magnavox - Odyssey2")], extensions: ["bin"], kind: "cartridge", providers: { launchbox: "Magnavox Odyssey 2" } },
  { slug: "channelf", name: "Channel F", maker: "Fairchild", year: 1976, folders: ["channelf", "fairchild"], dats: [noIntro("Fairchild - Channel F")], extensions: ["bin", "chf"], kind: "cartridge", providers: { launchbox: "Fairchild Channel F" } },
  { slug: "supervision", name: "Supervision", maker: "Watara", year: 1992, folders: ["supervision"], dats: [noIntro("Watara - Supervision")], extensions: ["sv", "bin"], kind: "cartridge", providers: { launchbox: "Watara Supervision" } },
  { slug: "arduboy", name: "Arduboy", maker: "Arduboy", year: 2016, folders: ["arduboy"], dats: [noIntro("Arduboy Inc - Arduboy")], extensions: ["hex", "arduboy"], kind: "cartridge", providers: { launchbox: "Arduboy" } },
  { slug: "cdi", name: "CD-i", maker: "Philips", year: 1991, folders: ["cdi", "cd-i"], dats: [redump("Philips - CD-i")], extensions: ["chd", "cue", "iso"], kind: "disc", providers: { launchbox: "Philips CD-i" } },
  { slug: "amigacd32", name: "Amiga CD32", maker: "Commodore", year: 1993, folders: ["amigacd32", "cd32"], dats: [redump("Commodore - CD32")], extensions: DISC, kind: "disc", providers: { launchbox: "Commodore Amiga CD32" } },

  // Computers: few of their dumps are in No-Intro, so most match by name.
  { slug: "c64", name: "Commodore 64", maker: "Commodore", year: 1982, folders: ["c64", "commodore64"], dats: [noIntro("Commodore - 64")], extensions: ["d64", "t64", "prg", "crt", "tap", "g64", "m3u"], kind: "computer", providers: { launchbox: "Commodore 64", screenscraper: 66 } },
  { slug: "amiga", name: "Amiga", maker: "Commodore", year: 1985, folders: ["amiga", "commodoreamiga"], dats: [noIntro("Commodore - Amiga")], extensions: ["adf", "ipf", "hdf", "lha", "m3u"], kind: "computer", providers: { launchbox: "Commodore Amiga", screenscraper: 64 } },
  { slug: "msx", name: "MSX", maker: "Microsoft", year: 1983, folders: ["msx", "msx1"], dats: [noIntro("Microsoft - MSX")], extensions: ["rom", "mx1", "mx2", "dsk", "cas"], kind: "computer", providers: { launchbox: "Microsoft MSX", screenscraper: 113 } },
  { slug: "msx2", name: "MSX2", maker: "Microsoft", year: 1985, folders: ["msx2"], dats: [noIntro("Microsoft - MSX2")], extensions: ["rom", "mx2", "dsk"], kind: "computer", providers: { launchbox: "Microsoft MSX2" } },
  { slug: "zxspectrum", name: "ZX Spectrum", maker: "Sinclair", year: 1982, folders: ["zxspectrum", "spectrum", "zx"], dats: [noIntro("Sinclair - ZX Spectrum +3")], extensions: ["tzx", "tap", "z80", "sna", "dsk"], kind: "computer", providers: { launchbox: "Sinclair ZX Spectrum", screenscraper: 76 } },
  { slug: "amstradcpc", name: "Amstrad CPC", maker: "Amstrad", year: 1984, folders: ["amstradcpc", "cpc"], dats: [], extensions: ["dsk", "cdt", "sna"], kind: "computer", providers: { launchbox: "Amstrad CPC", screenscraper: 65 } },
  { slug: "atarist", name: "Atari ST", maker: "Atari", year: 1985, folders: ["atarist", "st"], dats: [noIntro("Atari - ST")], extensions: ["st", "stx", "msa"], kind: "computer", providers: { launchbox: "Atari ST" } },
  { slug: "atari800", name: "Atari 8-bit", maker: "Atari", year: 1979, folders: ["atari800", "atari8bit"], dats: [noIntro("Atari - 8-bit Family")], extensions: ["atr", "xex", "car", "xfd"], kind: "computer", providers: { launchbox: "Atari 800" } },

  // Recognized so their folders aren't reported as unknown; scanning them comes later.
  { slug: "arcade", name: "Arcade", maker: null, year: null, folders: ["arcade", "mame", "fbneo", "fba", "finalburn", "mame2003", "mame2010"], dats: [], extensions: ["zip", "7z"], kind: "arcade", unsupported: "arcade sets are supported later", providers: { launchbox: "Arcade", screenscraper: 75 } },
  { slug: "neogeo", name: "Neo Geo", maker: "SNK", year: 1990, folders: ["neogeo", "neogeoaes"], dats: [], extensions: ["zip", "7z"], kind: "arcade", unsupported: "Neo Geo sets are supported later", providers: { launchbox: "SNK Neo Geo AES", screenscraper: 142 } },
];

/** A folder name reduced for comparing: lowercase letters and digits only. */
export const folderKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The DAT name of a DAT path: "no-intro/Sega - 32X.dat" -> "Sega - 32X". */
export const datName = (path: string) => path.replace(/^.*\//, "").replace(/\.dat$/, "");

/** The platform a slug, name or folder alias stands for. */
export function findPlatform(name: string): PlatformInfo | undefined {
  const key = folderKey(name);
  return PLATFORMS.find(
    (platform) =>
      folderKey(platform.slug) === key ||
      folderKey(platform.name) === key ||
      (platform.providers.launchbox !== undefined && folderKey(platform.providers.launchbox) === key) ||
      platform.folders.some((folder) => folderKey(folder) === key) ||
      platform.dats.some((dat) => folderKey(datName(dat)) === key),
  );
}

/**
 * Finds the platform a folder name stands for. `overrides` maps folder names
 * to platforms, by slug or name (from LIBRARY_ROM_PLATFORMS).
 */
export function platformForFolder(name: string, overrides: Record<string, string> = {}): PlatformInfo | undefined {
  const key = folderKey(name);
  for (const [folder, platform] of Object.entries(overrides)) {
    if (folderKey(folder) === key) return findPlatform(platform);
  }
  return findPlatform(name);
}

/** Archive formats the scanner looks inside. */
export const ARCHIVE_EXTENSIONS = ["zip", "7z"];
