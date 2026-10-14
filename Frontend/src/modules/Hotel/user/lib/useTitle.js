import { useEffect } from "react";

export default function useTitle(title) {
  useEffect(() => {
    if (title) document.title = `${title} | KSG Stays`;
  }, [title]);
}
