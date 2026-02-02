import hashlib

keys = ["bjPlXXD4Ek0CjdfO", "UTHJD51mONjeEVU3"]
target_uid = "72404eaf4685756b0f160ae0b29fcd736595754d5c8638e4c556bd538872145f"

print(f"Target UID: {target_uid}")
print("-" * 60)

for key in keys:
    # SHA-256 hash of the key
    hash_object = hashlib.sha256(key.encode('utf-8'))
    hex_dig = hash_object.hexdigest()
    print(f"Key: {key}")
    print(f"Hash: {hex_dig}")
    if hex_dig == target_uid:
        print("MATCH FOUND!")
    else:
        print("No match.")
    print("-" * 60)
