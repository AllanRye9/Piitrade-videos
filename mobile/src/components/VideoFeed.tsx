import React, { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import type { ListViewToken } from 'react-native';
import type { Video } from '../types';
import { colors } from '../theme';
import VideoCard from './VideoCard';

interface Props {
  videos: Video[];
  height: number;
  bottomInset?: number;
  onNearEnd?: () => void;
  onRefresh?: () => Promise<void> | void;
  /** Index to scroll to initially (used by profile/tag viewers). */
  initialIndex?: number;
}

export default function VideoFeed({ videos, height, bottomInset, onNearEnd, onRefresh, initialIndex = 0 }: Props) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [refreshing, setRefreshing] = useState(false);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && typeof v.index === 'number');
    if (first && typeof first.index === 'number') setActiveIndex(first.index);
  }).current;

  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <FlatList
      data={videos}
      keyExtractor={(v) => v.id}
      renderItem={({ item, index }) => <VideoCard video={item} active={index === activeIndex} height={height} bottomInset={bottomInset} />}
      pagingEnabled
      snapToInterval={height}
      snapToAlignment="start"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={(_d, index) => ({ length: height, offset: height * index, index })}
      initialScrollIndex={initialIndex}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={viewConfig}
      windowSize={3}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      removeClippedSubviews
      onEndReachedThreshold={2}
      onEndReached={onNearEnd}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} /> : undefined}
    />
  );
}
