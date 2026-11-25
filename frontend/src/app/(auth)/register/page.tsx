import type { Metadata } from "next";
import { RegisterForm } from "../../../features/auth/components/register-form";

export const metadata: Metadata = { title: "Napravi nalog | Chat System" };

export default function RegisterPage() {
  return <RegisterForm />;
}
