import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/argus/desk";

export const Route = createFileRoute("/")({
  component: Desk,
});
