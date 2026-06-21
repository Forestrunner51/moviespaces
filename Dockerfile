# 1. Build Stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build-env
WORKDIR /App

# Copy everything and restore dependencies
COPY . ./
RUN dotnet restore

# Build and publish a release
RUN dotnet publish -c Release -o out

# 2. Runtime Stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /App
COPY --from=build-env /App/out .

# Render exposes an environment variable called PORT dynamically
ENV ASPNETCORE_URLS=http://+:10000

ENTRYPOINT ["dotnet", "backend.dll"]
