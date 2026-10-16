"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
    {pending ? pendingLabel : label}
  </Button>;
}
