import { Tabs } from "expo-router";
import { StyleSheet, Text } from "react-native";

const palette = {
  background: "#08090A",
  surface: "#111317",
  primary: "#8B5CF6",
  text: "#F4F4F5",
  textMuted: "#A1A1AA",
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>{label}</Text>
  );
}

export default function TabsLayout() {
  return (
    // @ts-ignore expo-router Tabs has React version-dependent type variance
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => <TabIcon label="H" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dictionary"
        options={{
          title: "Dictionary",
          tabBarIcon: ({ focused }) => <TabIcon label="D" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="snippets"
        options={{
          title: "Snippets",
          tabBarIcon: ({ focused }) => <TabIcon label="S" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ focused }) => <TabIcon label="Q" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => <TabIcon label="G" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: palette.surface,
    borderTopColor: "#2A2F38",
    borderTopWidth: 1,
    height: 56,
    paddingBottom: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  icon: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.textMuted,
  },
  iconFocused: {
    color: palette.primary,
  },
});
