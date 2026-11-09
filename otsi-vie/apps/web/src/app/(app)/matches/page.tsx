import { redirect } from "next/navigation";

/** "Matches" opens the Library on its Matches tab (Page 09 section 2). */
export default function Page() {
  redirect("/library?tab=matches");
}
