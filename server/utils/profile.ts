import jdenticon from "jdenticon";

export async function generateIdenticonPNG(name: string, size: number = 100): Promise<Buffer> {
    return jdenticon.toPng(name, size);
}
