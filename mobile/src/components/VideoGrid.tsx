import React from 'react';
import { FlatList, FlatListProps, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import type { Video } from '../types';
import { mediaUrl } from '../config';
import { colors, radius, space } from '../theme';
import { Icon, formatCount } from './ui';

const GAP = 6;

export default function VideoGrid({
  videos,
  onOpen,
  emptyLabel,
  ListHeaderComponent,
  ...rest
}: {
  videos: Video[];
  onOpen: (index: number) => void;
  emptyLabel: string;
  ListHeaderComponent?: FlatListProps<Video>['ListHeaderComponent'];
} & Partial<Omit<FlatListProps<Video>, 'data' | 'renderItem'>>) {
  const { width } = useWindowDimensions();
  const size = (width - space.lg * 2 - GAP * 2) / 3;
  return (
    <FlatList
      {...rest}
      data={videos}
      numColumns={3}
      keyExtractor={(v) => v.id}
      columnWrapperStyle={{ gap: GAP, paddingHorizontal: space.lg }}
      contentContainerStyle={{ gap: GAP, paddingBottom: space.xxl }}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}
      renderItem={({ item, index }) => (
        <Pressable onPress={() => onOpen(index)} style={{ width: size, height: size * 1.6 }} accessibilityRole="button" accessibilityLabel={item.title || 'Video'}>
          <View style={styles.thumb}>
            {item.poster ? <Image source={{ uri: mediaUrl(item.poster) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="play" size={26} color={colors.textFaint} />}
            <View style={styles.meta}>
              <Icon name="heart" size={11} color="#fff" />
              <Text style={styles.metaText}>{formatCount(item.likes)}</Text>
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  thumb: { flex: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  meta: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { color: '#fff', fontSize: 11, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: space.xl },
});
