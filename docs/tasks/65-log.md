# Task 65 Log: Script maker in the Store (#151)

## Problems and Resolutions
1. **Tauri backend command missing in running Duet dev instance**:
   - Cause: Duet dev had been running from a background process built prior to the addition of `write_user_script` and `list_user_scripts`.
   - Resolution: Restarted Duet dev using `scripts/dev-duet.sh` configured with the active Rust toolchain.
2. **Initial window view stacking**:
   - Cause: On clean launch, Duet dev opens with `homeOpen: true`, rendering Home in front of the Store panel.
   - Resolution: Closed the Home view so the Store panel and script maker were front and center for inspection with `dev_*` tools.
