/* ================================================================
   TEXT EFFECTS MODULE
   Unicode-based text transformations for fun chat effects
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E-2025
   ================================================================ */

console.log('[TextEffects] Loading version 2026-01-23-v9 - removed strikethrough');

const TextEffects = (function() {

  // Upside down character map (flipped and reversed)
  const UPSIDE_DOWN_MAP = {
    'a': '\u0250', 'b': 'q', 'c': '\u0254', 'd': 'p', 'e': '\u01DD',
    'f': '\u025F', 'g': '\u0183', 'h': '\u0265', 'i': '\u0131', 'j': '\u027E',
    'k': '\u029E', 'l': 'l', 'm': '\u026F', 'n': 'u', 'o': 'o',
    'p': 'd', 'q': 'b', 'r': '\u0279', 's': 's', 't': '\u0287',
    'u': 'n', 'v': '\u028C', 'w': '\u028D', 'x': 'x', 'y': '\u028E',
    'z': 'z',
    'A': '\u2200', 'B': 'q', 'C': '\u0186', 'D': 'p', 'E': '\u018E',
    'F': '\u2132', 'G': '\u2141', 'H': 'H', 'I': 'I', 'J': '\u017F',
    'K': '\u029E', 'L': '\u02E5', 'M': 'W', 'N': 'N', 'O': 'O',
    'P': '\u0500', 'Q': '\u038C', 'R': '\u1D1A', 'S': 'S', 'T': '\u22A5',
    'U': '\u2229', 'V': '\u039B', 'W': 'M', 'X': 'X', 'Y': '\u2144',
    'Z': 'Z',
    '1': '\u0196', '2': '\u1105', '3': '\u0190', '4': '\u3123',
    '5': '\u03DB', '6': '9', '7': '\u3125', '8': '8', '9': '6', '0': '0',
    '.': '\u02D9', ',': "'", "'": ',', '"': ',,', '`': ',',
    '?': '\u00BF', '!': '\u00A1', '[': ']', ']': '[', '(': ')', ')': '(',
    '{': '}', '}': '{', '<': '>', '>': '<', '&': '\u214B',
    '_': '\u203E', ';': '\u061B', ' ': ' '
  };

  // Small caps character map
  const SMALL_CAPS_MAP = {
    'a': '\u1D00', 'b': '\u0299', 'c': '\u1D04', 'd': '\u1D05', 'e': '\u1D07',
    'f': '\u0493', 'g': '\u0262', 'h': '\u029C', 'i': '\u026A', 'j': '\u1D0A',
    'k': '\u1D0B', 'l': '\u029F', 'm': '\u1D0D', 'n': '\u0274', 'o': '\u1D0F',
    'p': '\u1D18', 'q': 'q', 'r': '\u0280', 's': '\u0455', 't': '\u1D1B',
    'u': '\u1D1C', 'v': '\u1D20', 'w': '\u1D21', 'x': 'x', 'y': '\u028F',
    'z': '\u1D22'
  };

  // Superscript character map
  const SUPERSCRIPT_MAP = {
    'a': '\u1D43', 'b': '\u1D47', 'c': '\u1D9C', 'd': '\u1D48', 'e': '\u1D49',
    'f': '\u1DA0', 'g': '\u1D4D', 'h': '\u02B0', 'i': '\u2071', 'j': '\u02B2',
    'k': '\u1D4F', 'l': '\u02E1', 'm': '\u1D50', 'n': '\u207F', 'o': '\u1D52',
    'p': '\u1D56', 'q': 'q', 'r': '\u02B3', 's': '\u02E2', 't': '\u1D57',
    'u': '\u1D58', 'v': '\u1D5B', 'w': '\u02B7', 'x': '\u02E3', 'y': '\u02B8',
    'z': '\u1DBB',
    'A': '\u1D2C', 'B': '\u1D2E', 'C': 'C', 'D': '\u1D30', 'E': '\u1D31',
    'F': 'F', 'G': '\u1D33', 'H': '\u1D34', 'I': '\u1D35', 'J': '\u1D36',
    'K': '\u1D37', 'L': '\u1D38', 'M': '\u1D39', 'N': '\u1D3A', 'O': '\u1D3C',
    'P': '\u1D3E', 'Q': 'Q', 'R': '\u1D3F', 'S': 'S', 'T': '\u1D40',
    'U': '\u1D41', 'V': '\u2C7D', 'W': '\u1D42', 'X': 'X', 'Y': 'Y',
    'Z': 'Z',
    '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074',
    '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
    '+': '\u207A', '-': '\u207B', '=': '\u207C', '(': '\u207D', ')': '\u207E'
  };

  // Double-struck (blackboard bold) character map - 𝕕𝕠𝕦𝕓𝕝𝕖 𝕤𝕥𝕣𝕦𝕔𝕜
  const DOUBLESTRUCK_MAP = {
    'a': '\uD835\uDD52', 'b': '\uD835\uDD53', 'c': '\uD835\uDD54', 'd': '\uD835\uDD55', 'e': '\uD835\uDD56',
    'f': '\uD835\uDD57', 'g': '\uD835\uDD58', 'h': '\uD835\uDD59', 'i': '\uD835\uDD5A', 'j': '\uD835\uDD5B',
    'k': '\uD835\uDD5C', 'l': '\uD835\uDD5D', 'm': '\uD835\uDD5E', 'n': '\uD835\uDD5F', 'o': '\uD835\uDD60',
    'p': '\uD835\uDD61', 'q': '\uD835\uDD62', 'r': '\uD835\uDD63', 's': '\uD835\uDD64', 't': '\uD835\uDD65',
    'u': '\uD835\uDD66', 'v': '\uD835\uDD67', 'w': '\uD835\uDD68', 'x': '\uD835\uDD69', 'y': '\uD835\uDD6A',
    'z': '\uD835\uDD6B',
    'A': '\uD835\uDD38', 'B': '\uD835\uDD39', 'C': '\u2102', 'D': '\uD835\uDD3B', 'E': '\uD835\uDD3C',
    'F': '\uD835\uDD3D', 'G': '\uD835\uDD3E', 'H': '\u210D', 'I': '\uD835\uDD40', 'J': '\uD835\uDD41',
    'K': '\uD835\uDD42', 'L': '\uD835\uDD43', 'M': '\uD835\uDD44', 'N': '\u2115', 'O': '\uD835\uDD46',
    'P': '\u2119', 'Q': '\u211A', 'R': '\u211D', 'S': '\uD835\uDD4A', 'T': '\uD835\uDD4B',
    'U': '\uD835\uDD4C', 'V': '\uD835\uDD4D', 'W': '\uD835\uDD4E', 'X': '\uD835\uDD4F', 'Y': '\uD835\uDD50',
    'Z': '\u2124',
    '0': '\uD835\uDFD8', '1': '\uD835\uDFD9', '2': '\uD835\uDFDA', '3': '\uD835\uDFDB', '4': '\uD835\uDFDC',
    '5': '\uD835\uDFDD', '6': '\uD835\uDFDE', '7': '\uD835\uDFDF', '8': '\uD835\uDFE0', '9': '\uD835\uDFE1'
  };

  // Bubble (circled) character map
  const BUBBLE_MAP = {
    'a': '\u24D0', 'b': '\u24D1', 'c': '\u24D2', 'd': '\u24D3', 'e': '\u24D4',
    'f': '\u24D5', 'g': '\u24D6', 'h': '\u24D7', 'i': '\u24D8', 'j': '\u24D9',
    'k': '\u24DA', 'l': '\u24DB', 'm': '\u24DC', 'n': '\u24DD', 'o': '\u24DE',
    'p': '\u24DF', 'q': '\u24E0', 'r': '\u24E1', 's': '\u24E2', 't': '\u24E3',
    'u': '\u24E4', 'v': '\u24E5', 'w': '\u24E6', 'x': '\u24E7', 'y': '\u24E8',
    'z': '\u24E9',
    'A': '\u24B6', 'B': '\u24B7', 'C': '\u24B8', 'D': '\u24B9', 'E': '\u24BA',
    'F': '\u24BB', 'G': '\u24BC', 'H': '\u24BD', 'I': '\u24BE', 'J': '\u24BF',
    'K': '\u24C0', 'L': '\u24C1', 'M': '\u24C2', 'N': '\u24C3', 'O': '\u24C4',
    'P': '\u24C5', 'Q': '\u24C6', 'R': '\u24C7', 'S': '\u24C8', 'T': '\u24C9',
    'U': '\u24CA', 'V': '\u24CB', 'W': '\u24CC', 'X': '\u24CD', 'Y': '\u24CE',
    'Z': '\u24CF',
    '0': '\u24EA', '1': '\u2460', '2': '\u2461', '3': '\u2462', '4': '\u2463',
    '5': '\u2464', '6': '\u2465', '7': '\u2466', '8': '\u2467', '9': '\u2468'
  };

  // Square character map (uses curly brace syntax for code points > 0xFFFF)
  const SQUARE_MAP = {
    'A': '\u{1F130}', 'B': '\u{1F131}', 'C': '\u{1F132}', 'D': '\u{1F133}', 'E': '\u{1F134}',
    'F': '\u{1F135}', 'G': '\u{1F136}', 'H': '\u{1F137}', 'I': '\u{1F138}', 'J': '\u{1F139}',
    'K': '\u{1F13A}', 'L': '\u{1F13B}', 'M': '\u{1F13C}', 'N': '\u{1F13D}', 'O': '\u{1F13E}',
    'P': '\u{1F13F}', 'Q': '\u{1F140}', 'R': '\u{1F141}', 'S': '\u{1F142}', 'T': '\u{1F143}',
    'U': '\u{1F144}', 'V': '\u{1F145}', 'W': '\u{1F146}', 'X': '\u{1F147}', 'Y': '\u{1F148}',
    'Z': '\u{1F149}',
    'a': '\u{1F130}', 'b': '\u{1F131}', 'c': '\u{1F132}', 'd': '\u{1F133}', 'e': '\u{1F134}',
    'f': '\u{1F135}', 'g': '\u{1F136}', 'h': '\u{1F137}', 'i': '\u{1F138}', 'j': '\u{1F139}',
    'k': '\u{1F13A}', 'l': '\u{1F13B}', 'm': '\u{1F13C}', 'n': '\u{1F13D}', 'o': '\u{1F13E}',
    'p': '\u{1F13F}', 'q': '\u{1F140}', 'r': '\u{1F141}', 's': '\u{1F142}', 't': '\u{1F143}',
    'u': '\u{1F144}', 'v': '\u{1F145}', 'w': '\u{1F146}', 'x': '\u{1F147}', 'y': '\u{1F148}',
    'z': '\u{1F149}'
  };

  // Wide (fullwidth) character map - offset from ASCII
  const WIDE_OFFSET = 0xFEE0; // Add to ASCII to get fullwidth

  // Bold character map (Mathematical Bold)
  const BOLD_MAP = {
    'A': '\u{1D400}', 'B': '\u{1D401}', 'C': '\u{1D402}', 'D': '\u{1D403}', 'E': '\u{1D404}',
    'F': '\u{1D405}', 'G': '\u{1D406}', 'H': '\u{1D407}', 'I': '\u{1D408}', 'J': '\u{1D409}',
    'K': '\u{1D40A}', 'L': '\u{1D40B}', 'M': '\u{1D40C}', 'N': '\u{1D40D}', 'O': '\u{1D40E}',
    'P': '\u{1D40F}', 'Q': '\u{1D410}', 'R': '\u{1D411}', 'S': '\u{1D412}', 'T': '\u{1D413}',
    'U': '\u{1D414}', 'V': '\u{1D415}', 'W': '\u{1D416}', 'X': '\u{1D417}', 'Y': '\u{1D418}',
    'Z': '\u{1D419}',
    'a': '\u{1D41A}', 'b': '\u{1D41B}', 'c': '\u{1D41C}', 'd': '\u{1D41D}', 'e': '\u{1D41E}',
    'f': '\u{1D41F}', 'g': '\u{1D420}', 'h': '\u{1D421}', 'i': '\u{1D422}', 'j': '\u{1D423}',
    'k': '\u{1D424}', 'l': '\u{1D425}', 'm': '\u{1D426}', 'n': '\u{1D427}', 'o': '\u{1D428}',
    'p': '\u{1D429}', 'q': '\u{1D42A}', 'r': '\u{1D42B}', 's': '\u{1D42C}', 't': '\u{1D42D}',
    'u': '\u{1D42E}', 'v': '\u{1D42F}', 'w': '\u{1D430}', 'x': '\u{1D431}', 'y': '\u{1D432}',
    'z': '\u{1D433}',
    '0': '\u{1D7CE}', '1': '\u{1D7CF}', '2': '\u{1D7D0}', '3': '\u{1D7D1}', '4': '\u{1D7D2}',
    '5': '\u{1D7D3}', '6': '\u{1D7D4}', '7': '\u{1D7D5}', '8': '\u{1D7D6}', '9': '\u{1D7D7}'
  };

  // Italic character map (Mathematical Italic)
  const ITALIC_MAP = {
    'A': '\u{1D434}', 'B': '\u{1D435}', 'C': '\u{1D436}', 'D': '\u{1D437}', 'E': '\u{1D438}',
    'F': '\u{1D439}', 'G': '\u{1D43A}', 'H': '\u{1D43B}', 'I': '\u{1D43C}', 'J': '\u{1D43D}',
    'K': '\u{1D43E}', 'L': '\u{1D43F}', 'M': '\u{1D440}', 'N': '\u{1D441}', 'O': '\u{1D442}',
    'P': '\u{1D443}', 'Q': '\u{1D444}', 'R': '\u{1D445}', 'S': '\u{1D446}', 'T': '\u{1D447}',
    'U': '\u{1D448}', 'V': '\u{1D449}', 'W': '\u{1D44A}', 'X': '\u{1D44B}', 'Y': '\u{1D44C}',
    'Z': '\u{1D44D}',
    'a': '\u{1D44E}', 'b': '\u{1D44F}', 'c': '\u{1D450}', 'd': '\u{1D451}', 'e': '\u{1D452}',
    'f': '\u{1D453}', 'g': '\u{1D454}', 'h': '\u{1D455}', 'i': '\u{1D456}', 'j': '\u{1D457}',
    'k': '\u{1D458}', 'l': '\u{1D459}', 'm': '\u{1D45A}', 'n': '\u{1D45B}', 'o': '\u{1D45C}',
    'p': '\u{1D45D}', 'q': '\u{1D45E}', 'r': '\u{1D45F}', 's': '\u{1D460}', 't': '\u{1D461}',
    'u': '\u{1D462}', 'v': '\u{1D463}', 'w': '\u{1D464}', 'x': '\u{1D465}', 'y': '\u{1D466}',
    'z': '\u{1D467}'
  };

  // Script character map (Mathematical Script - fancy cursive)
  const SCRIPT_MAP = {
    'A': '\u{1D49C}', 'B': '\u212C', 'C': '\u{1D49E}', 'D': '\u{1D49F}', 'E': '\u2130',
    'F': '\u2131', 'G': '\u{1D4A2}', 'H': '\u210B', 'I': '\u2110', 'J': '\u{1D4A5}',
    'K': '\u{1D4A6}', 'L': '\u2112', 'M': '\u2133', 'N': '\u{1D4A9}', 'O': '\u{1D4AA}',
    'P': '\u{1D4AB}', 'Q': '\u{1D4AC}', 'R': '\u211B', 'S': '\u{1D4AE}', 'T': '\u{1D4AF}',
    'U': '\u{1D4B0}', 'V': '\u{1D4B1}', 'W': '\u{1D4B2}', 'X': '\u{1D4B3}', 'Y': '\u{1D4B4}',
    'Z': '\u{1D4B5}',
    'a': '\u{1D4B6}', 'b': '\u{1D4B7}', 'c': '\u{1D4B8}', 'd': '\u{1D4B9}', 'e': '\u212F',
    'f': '\u{1D4BB}', 'g': '\u210A', 'h': '\u{1D4BD}', 'i': '\u{1D4BE}', 'j': '\u{1D4BF}',
    'k': '\u{1D4C0}', 'l': '\u{1D4C1}', 'm': '\u{1D4C2}', 'n': '\u{1D4C3}', 'o': '\u2134',
    'p': '\u{1D4C5}', 'q': '\u{1D4C6}', 'r': '\u{1D4C7}', 's': '\u{1D4C8}', 't': '\u{1D4C9}',
    'u': '\u{1D4CA}', 'v': '\u{1D4CB}', 'w': '\u{1D4CC}', 'x': '\u{1D4CD}', 'y': '\u{1D4CE}',
    'z': '\u{1D4CF}'
  };

  // Fraktur character map (old German blackletter/gothic)
  const FRAKTUR_MAP = {
    'A': '\u{1D504}', 'B': '\u{1D505}', 'C': '\u212D', 'D': '\u{1D507}', 'E': '\u{1D508}',
    'F': '\u{1D509}', 'G': '\u{1D50A}', 'H': '\u210C', 'I': '\u2111', 'J': '\u{1D50D}',
    'K': '\u{1D50E}', 'L': '\u{1D50F}', 'M': '\u{1D510}', 'N': '\u{1D511}', 'O': '\u{1D512}',
    'P': '\u{1D513}', 'Q': '\u{1D514}', 'R': '\u211C', 'S': '\u{1D516}', 'T': '\u{1D517}',
    'U': '\u{1D518}', 'V': '\u{1D519}', 'W': '\u{1D51A}', 'X': '\u{1D51B}', 'Y': '\u{1D51C}',
    'Z': '\u2128',
    'a': '\u{1D51E}', 'b': '\u{1D51F}', 'c': '\u{1D520}', 'd': '\u{1D521}', 'e': '\u{1D522}',
    'f': '\u{1D523}', 'g': '\u{1D524}', 'h': '\u{1D525}', 'i': '\u{1D526}', 'j': '\u{1D527}',
    'k': '\u{1D528}', 'l': '\u{1D529}', 'm': '\u{1D52A}', 'n': '\u{1D52B}', 'o': '\u{1D52C}',
    'p': '\u{1D52D}', 'q': '\u{1D52E}', 'r': '\u{1D52F}', 's': '\u{1D530}', 't': '\u{1D531}',
    'u': '\u{1D532}', 'v': '\u{1D533}', 'w': '\u{1D534}', 'x': '\u{1D535}', 'y': '\u{1D536}',
    'z': '\u{1D537}'
  };

  // Monospace character map (code/terminal style)
  const MONOSPACE_MAP = {
    'A': '\u{1D670}', 'B': '\u{1D671}', 'C': '\u{1D672}', 'D': '\u{1D673}', 'E': '\u{1D674}',
    'F': '\u{1D675}', 'G': '\u{1D676}', 'H': '\u{1D677}', 'I': '\u{1D678}', 'J': '\u{1D679}',
    'K': '\u{1D67A}', 'L': '\u{1D67B}', 'M': '\u{1D67C}', 'N': '\u{1D67D}', 'O': '\u{1D67E}',
    'P': '\u{1D67F}', 'Q': '\u{1D680}', 'R': '\u{1D681}', 'S': '\u{1D682}', 'T': '\u{1D683}',
    'U': '\u{1D684}', 'V': '\u{1D685}', 'W': '\u{1D686}', 'X': '\u{1D687}', 'Y': '\u{1D688}',
    'Z': '\u{1D689}',
    'a': '\u{1D68A}', 'b': '\u{1D68B}', 'c': '\u{1D68C}', 'd': '\u{1D68D}', 'e': '\u{1D68E}',
    'f': '\u{1D68F}', 'g': '\u{1D690}', 'h': '\u{1D691}', 'i': '\u{1D692}', 'j': '\u{1D693}',
    'k': '\u{1D694}', 'l': '\u{1D695}', 'm': '\u{1D696}', 'n': '\u{1D697}', 'o': '\u{1D698}',
    'p': '\u{1D699}', 'q': '\u{1D69A}', 'r': '\u{1D69B}', 's': '\u{1D69C}', 't': '\u{1D69D}',
    'u': '\u{1D69E}', 'v': '\u{1D69F}', 'w': '\u{1D6A0}', 'x': '\u{1D6A1}', 'y': '\u{1D6A2}',
    'z': '\u{1D6A3}',
    '0': '\u{1D7F6}', '1': '\u{1D7F7}', '2': '\u{1D7F8}', '3': '\u{1D7F9}', '4': '\u{1D7FA}',
    '5': '\u{1D7FB}', '6': '\u{1D7FC}', '7': '\u{1D7FD}', '8': '\u{1D7FE}', '9': '\u{1D7FF}'
  };

  // Sans-Serif Bold character map
  const SANS_BOLD_MAP = {
    'A': '\u{1D5D4}', 'B': '\u{1D5D5}', 'C': '\u{1D5D6}', 'D': '\u{1D5D7}', 'E': '\u{1D5D8}',
    'F': '\u{1D5D9}', 'G': '\u{1D5DA}', 'H': '\u{1D5DB}', 'I': '\u{1D5DC}', 'J': '\u{1D5DD}',
    'K': '\u{1D5DE}', 'L': '\u{1D5DF}', 'M': '\u{1D5E0}', 'N': '\u{1D5E1}', 'O': '\u{1D5E2}',
    'P': '\u{1D5E3}', 'Q': '\u{1D5E4}', 'R': '\u{1D5E5}', 'S': '\u{1D5E6}', 'T': '\u{1D5E7}',
    'U': '\u{1D5E8}', 'V': '\u{1D5E9}', 'W': '\u{1D5EA}', 'X': '\u{1D5EB}', 'Y': '\u{1D5EC}',
    'Z': '\u{1D5ED}',
    'a': '\u{1D5EE}', 'b': '\u{1D5EF}', 'c': '\u{1D5F0}', 'd': '\u{1D5F1}', 'e': '\u{1D5F2}',
    'f': '\u{1D5F3}', 'g': '\u{1D5F4}', 'h': '\u{1D5F5}', 'i': '\u{1D5F6}', 'j': '\u{1D5F7}',
    'k': '\u{1D5F8}', 'l': '\u{1D5F9}', 'm': '\u{1D5FA}', 'n': '\u{1D5FB}', 'o': '\u{1D5FC}',
    'p': '\u{1D5FD}', 'q': '\u{1D5FE}', 'r': '\u{1D5FF}', 's': '\u{1D600}', 't': '\u{1D601}',
    'u': '\u{1D602}', 'v': '\u{1D603}', 'w': '\u{1D604}', 'x': '\u{1D605}', 'y': '\u{1D606}',
    'z': '\u{1D607}',
    '0': '\u{1D7EC}', '1': '\u{1D7ED}', '2': '\u{1D7EE}', '3': '\u{1D7EF}', '4': '\u{1D7F0}',
    '5': '\u{1D7F1}', '6': '\u{1D7F2}', '7': '\u{1D7F3}', '8': '\u{1D7F4}', '9': '\u{1D7F5}'
  };

  // Negative squared (white on black) character map
  const NEG_SQUARE_MAP = {
    'A': '\u{1F170}', 'B': '\u{1F171}', 'C': '\u{1F172}', 'D': '\u{1F173}', 'E': '\u{1F174}',
    'F': '\u{1F175}', 'G': '\u{1F176}', 'H': '\u{1F177}', 'I': '\u{1F178}', 'J': '\u{1F179}',
    'K': '\u{1F17A}', 'L': '\u{1F17B}', 'M': '\u{1F17C}', 'N': '\u{1F17D}', 'O': '\u{1F17E}',
    'P': '\u{1F17F}', 'Q': '\u{1F180}', 'R': '\u{1F181}', 'S': '\u{1F182}', 'T': '\u{1F183}',
    'U': '\u{1F184}', 'V': '\u{1F185}', 'W': '\u{1F186}', 'X': '\u{1F187}', 'Y': '\u{1F188}',
    'Z': '\u{1F189}',
    'a': '\u{1F170}', 'b': '\u{1F171}', 'c': '\u{1F172}', 'd': '\u{1F173}', 'e': '\u{1F174}',
    'f': '\u{1F175}', 'g': '\u{1F176}', 'h': '\u{1F177}', 'i': '\u{1F178}', 'j': '\u{1F179}',
    'k': '\u{1F17A}', 'l': '\u{1F17B}', 'm': '\u{1F17C}', 'n': '\u{1F17D}', 'o': '\u{1F17E}',
    'p': '\u{1F17F}', 'q': '\u{1F180}', 'r': '\u{1F181}', 's': '\u{1F182}', 't': '\u{1F183}',
    'u': '\u{1F184}', 'v': '\u{1F185}', 'w': '\u{1F186}', 'x': '\u{1F187}', 'y': '\u{1F188}',
    'z': '\u{1F189}'
  };

  // Leet speak character map
  const LEET_MAP = {
    'a': '4', 'A': '4',
    'b': '8', 'B': '8',
    'c': '(', 'C': '(',
    'e': '3', 'E': '3',
    'g': '6', 'G': '6',
    'h': '#', 'H': '#',
    'i': '1', 'I': '1',
    'l': '1', 'L': '1',
    'o': '0', 'O': '0',
    's': '5', 'S': '5',
    't': '7', 'T': '7',
    'z': '2', 'Z': '2'
  };

  // Combining diacritical marks for zalgo effect
  const ZALGO_UP = [
    '\u030D', '\u030E', '\u0304', '\u0305', '\u033F', '\u0311', '\u0306',
    '\u0310', '\u0352', '\u0357', '\u0351', '\u0307', '\u0308', '\u030A',
    '\u0342', '\u0343', '\u0344', '\u034A', '\u034B', '\u034C', '\u0303'
  ];
  const ZALGO_MID = [
    '\u0315', '\u031B', '\u0340', '\u0341', '\u0358', '\u0321', '\u0322',
    '\u0327', '\u0328', '\u0334', '\u0335', '\u0336', '\u034F', '\u035C'
  ];
  const ZALGO_DOWN = [
    '\u0316', '\u0317', '\u0318', '\u0319', '\u031C', '\u031D', '\u031E',
    '\u031F', '\u0320', '\u0324', '\u0325', '\u0326', '\u0329', '\u032A',
    '\u032B', '\u032C', '\u032D', '\u032E', '\u032F', '\u0330', '\u0331'
  ];

  // Available effects with metadata
  const EFFECTS = [
    { id: 'upside-down', name: 'Upside Down', example: 'uʍop ǝpᴉsd∩' },
    { id: 'small-caps', name: 'Small Caps', example: '\u0455\u1D0D\u1D00\u029F\u029F \u1D04\u1D00\u1D18\u0455' },
    { id: 'superscript', name: 'Superscript', example: '\u02E2\u1D58\u1D56\u1D49\u02B3\u02E2\u1D9C\u02B3\u2071\u1D56\u1D57' },
    { id: 'doublestruck', name: 'Double', example: '\uD835\uDD55\uD835\uDD60\uD835\uDD66\uD835\uDD53\uD835\uDD5D\uD835\uDD56' },
    { id: 'bubble', name: 'Bubble', example: '\u24D1\u24E4\u24D1\u24D1\u24DB\u24D4' },
    { id: 'square', name: 'Square', example: '\u{1F142}\u{1F140}\u{1F144}\u{1F130}\u{1F141}\u{1F134}' },
    { id: 'zalgo', name: 'Zalgo', example: 'z\u0352\u0316a\u0310\u0329l\u0357\u031Cg\u0351\u0320o\u0311\u0325' },
    { id: 'wide', name: 'Wide', example: '\uFF57\uFF49\uFF44\uFF45' },
    { id: 'bold', name: 'Bold', example: '\u{1D41B}\u{1D428}\u{1D425}\u{1D41D}' },
    { id: 'italic', name: 'Italic', example: '\u{1D456}\u{1D461}\u{1D44E}\u{1D459}\u{1D456}\u{1D450}' },
    { id: 'script', name: 'Script', example: '\u{1D4C8}\u{1D4C2}\u{1D4B6}\u{1D4C3}\u{1D4C8}\u{1D4CE}' },
    { id: 'fraktur', name: 'Fraktur', example: '\u{1D523}\u{1D52F}\u{1D51E}\u{1D528}\u{1D531}\u{1D532}\u{1D52F}' },
    { id: 'monospace', name: 'Mono', example: '\u{1D696}\u{1D698}\u{1D697}\u{1D698}' },
    { id: 'sans-bold', name: 'Sans Bold', example: '\u{1D600}\u{1D5EE}\u{1D5FB}\u{1D600}' },
    { id: 'neg-square', name: 'Neg Square', example: '\u{1F17D}\u{1F174}\u{1F176}' },
    { id: 'underline', name: 'Underline', example: 'u\u0332n\u0332d\u0332e\u0332r\u0332' },
    { id: 'leet', name: 'Leet', example: '1337' },
    { id: 'alternating', name: 'Alternating', example: 'aLtErNaTiNg' }
  ];

  /**
   * Transform text using a character map
   */
  function mapTransform(text, charMap, preserveCase = true) {
    return text.split('').map(char => {
      if (charMap[char]) {
        return charMap[char];
      }
      // Try lowercase version if uppercase not found
      if (preserveCase && charMap[char.toLowerCase()]) {
        return charMap[char.toLowerCase()];
      }
      return char;
    }).join('');
  }

  /**
   * Upside down transformation (flip and reverse)
   */
  function upsideDown(text) {
    return text.split('').map(char => UPSIDE_DOWN_MAP[char] || char).reverse().join('');
  }

  /**
   * Small caps transformation
   */
  function smallCaps(text) {
    return mapTransform(text.toLowerCase(), SMALL_CAPS_MAP);
  }

  /**
   * Superscript transformation
   */
  function superscript(text) {
    return mapTransform(text, SUPERSCRIPT_MAP);
  }

  /**
   * Double-struck (blackboard bold) transformation - 𝕕𝕠𝕦𝕓𝕝𝕖 𝕤𝕥𝕣𝕦𝕔𝕜
   */
  function doublestruck(text) {
    return mapTransform(text, DOUBLESTRUCK_MAP);
  }

  /**
   * Bubble (circled) transformation
   */
  function bubble(text) {
    return mapTransform(text, BUBBLE_MAP);
  }

  /**
   * Square transformation
   */
  function square(text) {
    return mapTransform(text.toUpperCase(), SQUARE_MAP);
  }

  /**
   * Strikethrough transformation (combining character)
   */
  function strikethrough(text) {
    return text.split('').map(char => char === ' ' ? char : char + '\u0336').join('');
  }

  /**
   * Zalgo transformation (subtle - 1-2 marks per character)
   */
  function zalgo(text) {
    return text.split('').map(char => {
      if (char === ' ') return char;
      let result = char;
      // Add 0-1 marks above
      if (Math.random() > 0.3) {
        result += ZALGO_UP[Math.floor(Math.random() * ZALGO_UP.length)];
      }
      // Add 0-1 marks below
      if (Math.random() > 0.3) {
        result += ZALGO_DOWN[Math.floor(Math.random() * ZALGO_DOWN.length)];
      }
      // Rarely add middle mark
      if (Math.random() > 0.7) {
        result += ZALGO_MID[Math.floor(Math.random() * ZALGO_MID.length)];
      }
      return result;
    }).join('');
  }

  /**
   * Wide (fullwidth) transformation
   */
  function wide(text) {
    return text.split('').map(char => {
      const code = char.charCodeAt(0);
      // Only transform ASCII printable characters (33-126)
      if (code >= 33 && code <= 126) {
        return String.fromCharCode(code + WIDE_OFFSET);
      }
      // Space becomes ideographic space
      if (char === ' ') return '\u3000';
      return char;
    }).join('');
  }

  /**
   * Bold transformation
   */
  function bold(text) {
    return mapTransform(text, BOLD_MAP);
  }

  /**
   * Italic transformation
   */
  function italic(text) {
    return mapTransform(text, ITALIC_MAP);
  }

  /**
   * Script (fancy cursive) transformation
   */
  function script(text) {
    return mapTransform(text, SCRIPT_MAP);
  }

  /**
   * Fraktur (old German blackletter/gothic) transformation
   */
  function fraktur(text) {
    return mapTransform(text, FRAKTUR_MAP);
  }

  /**
   * Monospace (code/terminal style) transformation
   */
  function monospace(text) {
    return mapTransform(text, MONOSPACE_MAP);
  }

  /**
   * Sans-Serif Bold transformation
   */
  function sansBold(text) {
    return mapTransform(text, SANS_BOLD_MAP);
  }

  /**
   * Negative squared (white on black) transformation
   */
  function negSquare(text) {
    return mapTransform(text.toUpperCase(), NEG_SQUARE_MAP);
  }

  /**
   * Underline transformation (combining character)
   */
  function underline(text) {
    return text.split('').map(char => char === ' ' ? char : char + '\u0332').join('');
  }

  /**
   * Leet speak transformation
   */
  function leet(text) {
    return text.split('').map(char => LEET_MAP[char] || char).join('');
  }

  /**
   * Alternating case transformation (SpOnGeBoB mocking)
   */
  function alternating(text) {
    let upper = false;
    return text.split('').map(char => {
      if (/[a-zA-Z]/.test(char)) {
        upper = !upper;
        return upper ? char.toUpperCase() : char.toLowerCase();
      }
      return char;
    }).join('');
  }

  /**
   * Apply an effect by ID
   */
  function applyEffect(text, effectId) {
    if (!text || !effectId) return text;

    switch (effectId) {
      case 'upside-down': return upsideDown(text);
      case 'small-caps': return smallCaps(text);
      case 'superscript': return superscript(text);
      case 'doublestruck': return doublestruck(text);
      case 'bubble': return bubble(text);
      case 'square': return square(text);
      case 'zalgo': return zalgo(text);
      case 'wide': return wide(text);
      case 'bold': return bold(text);
      case 'italic': return italic(text);
      case 'script': return script(text);
      case 'fraktur': return fraktur(text);
      case 'monospace': return monospace(text);
      case 'sans-bold': return sansBold(text);
      case 'neg-square': return negSquare(text);
      case 'underline': return underline(text);
      case 'leet': return leet(text);
      case 'alternating': return alternating(text);
      default: return text;
    }
  }

  /**
   * Get list of available effects
   */
  function getEffects() {
    return EFFECTS;
  }

  /**
   * Get effect by ID
   */
  function getEffect(effectId) {
    return EFFECTS.find(e => e.id === effectId);
  }

  // Public API
  return {
    applyEffect,
    getEffects,
    getEffect,
    // Individual transforms (for direct use if needed)
    upsideDown,
    smallCaps,
    superscript,
    doublestruck,
    bubble,
    square,
    zalgo,
    wide,
    bold,
    italic,
    script,
    fraktur,
    monospace,
    sansBold,
    negSquare,
    underline,
    leet,
    alternating
  };
})();

// Export for global access
window.TextEffects = TextEffects;
