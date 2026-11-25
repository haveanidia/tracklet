declare module '@techstark/opencv-js' {
  /** The package ships an async factory whose result is the OpenCV module. */
  const cvFactory: () => Promise<any>;
  export default cvFactory;
}
