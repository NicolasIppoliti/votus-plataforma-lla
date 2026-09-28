import { cn as combineClasses, type ClassValue } from "cn";

export function cn(...inputs: ClassValue[]) {
	return combineClasses(...inputs);
}
