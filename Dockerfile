# 1. Build Stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env
WORKDIR /App

# Copy everything and restore dependencies
COPY . ./
# Point directly to your deeply nested project file
RUN dotnet restore "src/backend/backend/backend.csproj"

# Build and publish targeting that same folder
RUN dotnet publish "src/backend/backend/backend.csproj" -c Release -o out
# Build and publish a release
RUN dotnet publish -c Release -o out

# 2. Runtime Stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /App
COPY --from=build-env /App/out .

# Render exposes an environment variable called PORT dynamically
ENV ASPNETCORE_URLS=http://+:10000

ENTRYPOINT ["dotnet", "backend.dll"]
