import Carbon
import Foundation

let preferredInputSourceIDs = [
  "com.apple.keylayout.ABC",
  "com.apple.keylayout.US",
  "com.apple.keylayout.British",
  "com.apple.keylayout.Australian"
]

func inputSource(id: String) -> TISInputSource? {
  let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
  guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource] else {
    return nil
  }
  return list.first
}

func select(_ source: TISInputSource) -> Bool {
  TISSelectInputSource(source) == noErr
}

for id in preferredInputSourceIDs {
  if let source = inputSource(id: id), select(source) {
    exit(0)
  }
}

if let source = TISCopyInputSourceForLanguage("en" as CFString)?.takeRetainedValue(),
   select(source) {
  exit(0)
}

fputs("No English input source could be selected.\n", stderr)
exit(1)
