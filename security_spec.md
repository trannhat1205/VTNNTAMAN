# Security Specification (`security_spec.md`) — VTNN Tâm An

## 1. Data Invariants

1. **Default Deny & Verified Identity**: All Firestore paths default to `allow read, write: if false;`. Every write operation requires a signed-in user with `request.auth.token.email_verified == true`.
2. **Role & Privilege Escalation Guard**:
   - Bootstrapped Manager/Admin is verified via `request.auth.token.email == 'trannhat1205@gmail.com' && request.auth.token.email_verified == true` OR `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`.
   - Regular users creating `/staff/{userId}` can only self-register as `role == 'staff'` unless they are `isAdmin()`.
   - Users cannot modify their own `role` field in `/staff/{userId}` unless `isAdmin()`.
3. **PII Isolation**:
   - Staff PII (`email`, `phone`) is stored in `/staff_private/{userId}` and can only be read/written by `isOwner(userId) || isAdmin()`.
   - Customer and supplier phone numbers in `/sales/{saleId}` and `/imports/{importId}` are scoped to `resource.data.ownerId == request.auth.uid || isAdmin()`.
4. **Relational Existence & Ownership**:
   - Every `/sales/{saleId}` and `/imports/{importId}` creation requires `exists(/databases/$(database)/documents/products/$(incoming().productId))` and `incoming().ownerId == request.auth.uid`.
   - `ownerId` and `createdAt` are strictly immutable across all updates (`incoming().ownerId == existing().ownerId && incoming().createdAt == existing().createdAt`).
5. **Temporal Integrity**:
   - All `createdAt` fields on `create` must equal `request.time`.
   - All `updatedAt` fields on `create` and `update` must equal `request.time`.
6. **Terminal State Locking**:
   - Once a `/backups/{backupId}` document is created with `status == 'completed'`, it cannot be updated by non-admins.
   - Once a `/sales/{saleId}` or `/imports/{importId}` reaches `status == 'paid'` and `debtAmount == 0`, non-admin users cannot revert it to unpaid.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Shadow Field Injection)**: Create a product in `/products/prod_1` with all valid fields plus `"isSuperAdmin": true`. -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
2. **Payload 2 (Self-Assigned Manager Role)**: Non-admin user creates `/staff/user_123` with `role: "manager"`. -> `PERMISSION_DENIED` (blocked by self-role escalation guard).
3. **Payload 3 (Unverified Email Spoofing)**: User with `email: "trannhat1205@gmail.com"` but `email_verified: false` attempts to write `/admins/user_999`. -> `PERMISSION_DENIED` (blocked by `email_verified == true`).
4. **Payload 4 (ID Poisoning / Oversized Document ID)**: Create `/products/{150_char_id}` or ID containing `$!@#`. -> `PERMISSION_DENIED` (blocked by `isValidId()`).
5. **Payload 5 (Identity Spoofing on Create)**: User `uid_A` creates `/sales/sale_1` with `ownerId: "uid_B"`. -> `PERMISSION_DENIED` (blocked by `data.ownerId == request.auth.uid`).
6. **Payload 6 (Orphaned Sale Without Existing Product)**: Create `/sales/sale_1` referencing `productId: "non_existent_prod"`. -> `PERMISSION_DENIED` (blocked by `exists(.../products/$(incoming().productId))`).
7. **Payload 7 (Cross-User PII Leak)**: User `uid_A` attempts `get` on `/staff_private/uid_B`. -> `PERMISSION_DENIED` (blocked by `isOwner(userId) || isAdmin()`).
8. **Payload 8 (Update-Gap / Value Poisoning)**: User updates `/products/prod_1` with `affectedKeys().hasOnly(['stock', 'updatedAt'])` but sets `stock: -999` or `stock: "invalid"`. -> `PERMISSION_DENIED` (blocked by `isValidProduct(incoming())` wrapping the update block).
9. **Payload 9 (Immortal Field Mutation)**: User updates `/sales/sale_1` and alters `createdAt` or `ownerId`. -> `PERMISSION_DENIED` (blocked by immutability invariant).
10. **Payload 10 (Forged Client Timestamp)**: User creates `/imports/imp_1` with `createdAt` set to a past timestamp instead of `request.time`. -> `PERMISSION_DENIED` (blocked by `incoming().createdAt == request.time`).
11. **Payload 11 (Terminal State Reversal)**: Staff user attempts to update a completed `/sales/sale_paid` (` existing().status == 'paid'`) back to `'unpaid'`. -> `PERMISSION_DENIED` (blocked by terminal state gate).
12. **Payload 12 (Blanket List Scraping)**: User attempts an unconstrained `list` query on `/sales` where `resource.data.ownerId != request.auth.uid`. -> `PERMISSION_DENIED` (blocked by query enforcer `resource.data.ownerId == request.auth.uid || isAdmin()`).
