// 图片类型声明
declare module '*.png' {
    const src: string; // 导出资源路径字符串
    export default src;
  }
  
  declare module '*.jpg' {
    const src: string;
    export default src;
  }
  
  declare module '*.jpeg' {
    const src: string;
    export default src;
  }
  
  declare module '*.gif' {
    const src: string;
    export default src;
  }
  
  declare module '*.svg' {
    const src: string;
    export default src;
  }

  declare module '*.webp' {
    const src: string;
    export default src;
  }
  
  // 可选：字体类型声明
  declare module '*.woff' {
    const src: string;
    export default src;
  }
  
  declare module '*.woff2' {
    const src: string;
    export default src;
  }