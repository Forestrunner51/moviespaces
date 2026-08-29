# 1. Build Stage
#
# Pinned to the exact SDK/runtime the project is built and tested against
# locally (dotnet --version → 10.0.103, ASP.NET Core runtime 10.0.3), so a
# Render rebuild can't silently pick up a newer patch than what was verified.
# Bump both together when upgrading locally.
FROM mcr.microsoft.com/dotnet/sdk:10.0.103-noble AS build-env
WORKDIR /App

# Copy everything (see .dockerignore for what's excluded) and restore
COPY . ./
# Point directly to your deeply nested project file
RUN dotnet restore "src/backend/backend/backend.csproj"

# Build and publish targeting that same folders
RUN dotnet publish "src/backend/backend/backend.csproj" -c Release -o out

# 2. Runtime Stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0.3-noble
WORKDIR /App

# Npgsql attempts GSS encryption negotiation against Postgres (e.g. Supabase's
# pooler) and needs libgssapi at runtime; the base image doesn't include it.
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build-env /App/out .

# The listening port is decided in ONE place: Program.cs reads Render's PORT
# env var (fallback 10000). Deliberately no ASPNETCORE_URLS here — setting
# both would give two sources of truth that can disagree.

ENTRYPOINT ["dotnet", "backend.dll"]
