import type { Metadata } from "next";
import ReservationApp from "./reservation-app";

export const metadata: Metadata = {
  description: "Resident amenity reservations and scheduled bookings.",
};

export default function Home() {
  return <ReservationApp />;
}
