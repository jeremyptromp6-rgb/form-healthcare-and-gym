import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { PhotoCreditsView } from './PhotoCreditsView';

const credits = [
  { food: 'Banana, raw', author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:Banana.jpg' },
  { food: 'Apple, raw', author: 'John Roe', license: 'CC0', licenseUrl: '', source: 'https://commons.wikimedia.org/wiki/File:Apple.jpg' },
];

const appCredits = [{ slot: 'home' as const, title: 'Yoga sunrise', author: 'Dave Contreras', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'https://commons.wikimedia.org/wiki/File:Yoga.jpg' }];

describe('PhotoCreditsView', () => {
  it('lists the app photos in their own section, with links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<PhotoCreditsView credits={credits} appCredits={appCredits} />);
    expect(screen.getByText('App photos')).toBeTruthy();
    expect(screen.getByText('Dave Contreras · CC0')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Source for Yoga sunrise' }));
    expect(open).toHaveBeenCalledWith('https://commons.wikimedia.org/wiki/File:Yoga.jpg');
  });

  it('shows no app photos section without app credits', async () => {
    await render(<PhotoCreditsView credits={credits} />);
    expect(screen.queryByText('App photos')).toBeNull();
  });

  it('lists each photo with its author and licence', async () => {
    await render(<PhotoCreditsView credits={credits} />);
    expect(screen.getByText('Banana, raw')).toBeTruthy();
    expect(screen.getByText('Jane Doe · CC BY-SA 4.0')).toBeTruthy();
    expect(screen.getByText('John Roe · CC0')).toBeTruthy();
  });

  it('opens the licence and the source from tappable links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<PhotoCreditsView credits={credits} />);
    await fireEvent.press(screen.getByRole('link', { name: 'License for Banana, raw' }));
    expect(open).toHaveBeenCalledWith('https://creativecommons.org/licenses/by-sa/4.0');
    await fireEvent.press(screen.getByRole('link', { name: 'Source for Apple, raw' }));
    expect(open).toHaveBeenCalledWith('https://commons.wikimedia.org/wiki/File:Apple.jpg');
    expect(screen.queryByRole('link', { name: 'License for Apple, raw' })).toBeNull();
  });
});
