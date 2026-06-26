import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect } from "react";

export function useUser() {
  const [userName, setUserNameState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("userName").then((name) => {
      setUserNameState(name);
      setLoading(false);
    });
  }, []);

  const saveUserName = async (name: string) => {
    await AsyncStorage.setItem("userName", name);
    setUserNameState(name);
  };

  return { userName, saveUserName, loading };
}
