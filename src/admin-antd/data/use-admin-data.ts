import { useContext } from 'react';

import { AdminDataContext } from './admin-data';
import type { AdminData } from './admin-data';

/**
 * 读取管理后台共享数据层。
 *
 * 只在 `<AdminDataProvider>` 内使用；离开 Provider 会直接抛错（而不是返回空对象让视图静默白屏）。
 * M2 之后视图组件直接调用本 hook，不再通过 Dashboard 逐层传 scope。
 */
export function useAdminData(): AdminData {
  const value = useContext(AdminDataContext);
  if (!value) {
    throw new Error('useAdminData 必须在 <AdminDataProvider> 内使用');
  }
  return value;
}
