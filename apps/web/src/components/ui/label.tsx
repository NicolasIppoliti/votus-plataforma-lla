"use client";

import type { ComponentProps } from "react";
import * as LabelPrimitive from "radix-ui/label";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("flex items-center gap-2 font-bold", className)}
      {...props}
    />
  );
}

export { Label };
