import Foundation
import Security

let args = CommandLine.arguments
guard args.count == 3, args[2].count == 64,
      args[2].utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { exit(2) }

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "dev.herdr.lan-workspace.ssh",
    kSecAttrAccount as String: args[2]
]
switch args[1] {
case "get":
    var item: CFTypeRef?
    var lookup = query
    lookup[kSecReturnData as String] = true
    let status = SecItemCopyMatching(lookup as CFDictionary, &item)
    if status == errSecItemNotFound { exit(3) }
    guard status == errSecSuccess, let data = item as? Data else { exit(1) }
    FileHandle.standardOutput.write(data)
case "save", "update":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty, secret.count <= 8192 else { exit(2) }
    let value = [kSecValueData as String: secret] as CFDictionary
    if args[1] == "update" {
        let status = SecItemUpdate(query as CFDictionary, value)
        guard status == errSecSuccess || status == errSecItemNotFound else { exit(1) }
        break
    }
    var record = query
    record[kSecValueData as String] = secret
    var status = SecItemAdd(record as CFDictionary, nil)
    if status == errSecDuplicateItem {
        status = SecItemUpdate(query as CFDictionary, value)
    }
    guard status == errSecSuccess else { exit(1) }
case "forget":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { exit(1) }
default:
    exit(2)
}
