# Render deploy troubleshooting

If deploy fails with **"Exited with status 1 while building your code"**:

1. **Get the real error**  
   Render Dashboard → your **hexabill-api** service → **Logs** → open the **failed deploy** → open the **Build** log. Scroll for the first line containing `error` (e.g. `error CS`, `error MSB`, `The type ... could not be found`, or NuGet/COPY errors).

2. **Service settings**  
   If **Root Directory** is blank, Render uses the repo root as Docker context; the Dockerfile uses `COPY backend/HexaBill.Api/...` so the build works. **Dockerfile Path** should be `backend/HexaBill.Api/Dockerfile`. If you set Root Directory to `backend/HexaBill.Api`, set **Docker context** to repo root (`.`) and Dockerfile path to `backend/HexaBill.Api/Dockerfile` so the COPY paths resolve.

3. **This repo**  
   - SeedData xlsx are optional (Condition in csproj); build works if they’re missing.  
   - `.dockerignore` keeps bin/obj/.git out of the Docker context.

Share the exact Build log error line to fix the failure.
