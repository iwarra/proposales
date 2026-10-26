import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Uploads are up to 1 MB. The extra room covers multipart overhead,
      // so a file just over 1 MB reaches the app and gets its own message.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
