import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "TFC Amenities", template: "%s · TFC Amenities" },
    description: "Resident amenity reservations and scheduled bookings.",
    openGraph: {
      title: "TFC Amenities",
      description: "Reservations",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "TFC Amenities reservations calendar" }],
    },
    twitter: { card: "summary_large_image", title: "TFC Amenities", description: "Reservations", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={sans.variable}>{children}</body>
    </html>
  );
}
